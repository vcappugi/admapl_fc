<?php
// ==============================================================================
// FlujoCaja Pro - Importación de Movimientos desde Archivo CSV
// Valida los registros según Formato_Movimientos.csv y los inserta en fc_mov
// ==============================================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

ini_set('display_errors', '0');
error_reporting(E_ALL);

// 1. Conexión a Base de Datos Local SQLite
$db_path = __DIR__ . '/flujocaja.db';
if (!file_exists($db_path)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Base de datos SQLite local no encontrada.']);
    exit;
}

try {
    $pdo = new PDO("sqlite:" . $db_path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Error de conexión SQLite: ' . $e->getMessage()]);
    exit;
}

// 2. Credenciales Supabase desde .env
$envFile = __DIR__ . '/.env';
$supabaseUrl = 'https://usefcdjvclapepzwrzqm.supabase.co';
$supabaseKey = 'sb_publishable_yg_bXwB_Ul1noXV_0jqUcg_IrNa1gy0';

if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line && $line[0] !== '#' && strpos($line, '=') !== false) {
            list($k, $v) = explode('=', $line, 2);
            $k = trim($k);
            $v = trim(trim($v), "'\"");
            if ($k === 'URL') $supabaseUrl = rtrim($v, '/');
            if ($k === 'APIKEY') $supabaseKey = $v;
        }
    }
}

// Función auxiliar para llamadas a Supabase
function callSupabase($url, $method = 'GET', $body = null, $supabaseKey = '') {
    $ch = curl_init($url);
    $headers = [
        'apikey: ' . $supabaseKey,
        'Authorization: Bearer ' . $supabaseKey,
        'Content-Type: application/json',
        'Prefer: return=representation'
    ];
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
    }

    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['code' => $code, 'data' => $response ? json_decode($response, true) : null, 'raw' => $response];
}

// Nombres de meses en español
$MESES = [
    1 => 'ENERO', 2 => 'FEBRERO', 3 => 'MARZO', 4 => 'ABRIL',
    5 => 'MAYO', 6 => 'JUNIO', 7 => 'JULIO', 8 => 'AGOSTO',
    9 => 'SEPTIEMBRE', 10 => 'OCTUBRE', 11 => 'NOVIEMBRE', 12 => 'DICIEMBRE'
];

// Parser de fecha: acepta DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
function parseDate($val) {
    if (!$val) return null;
    $val = trim($val);
    if (!$val) return null;

    // DD/MM/YYYY o DD-MM-YYYY
    if (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/', $val, $m)) {
        $d = (int)$m[1];
        $mth = (int)$m[2];
        $y = (int)$m[3];
        if ($y < 100) $y += 2000;
        if (checkdate($mth, $d, $y)) {
            return sprintf('%04d-%02d-%02d', $y, $mth, $d);
        }
        return null;
    }

    // YYYY-MM-DD
    if (preg_match('/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/', $val, $m)) {
        $y = (int)$m[1];
        $mth = (int)$m[2];
        $d = (int)$m[3];
        if (checkdate($mth, $d, $y)) {
            return sprintf('%04d-%02d-%02d', $y, $mth, $d);
        }
        return null;
    }

    return null;
}

// Parser numérico: soporta formato venezolano (1.234,56 / -131.981,20) y estándar (1234.56)
function parseNumber($val) {
    if ($val === null || $val === '') return null;
    $val = trim((string)$val);
    $val = str_replace(' ', '', $val);
    if ($val === '' || in_array($val, ['-', '--', 'N/A', '#N/A', '.', '-.'], true)) {
        return null;
    }

    $isNeg = false;
    if (strpos($val, '(') === 0 && substr($val, -1) === ')') {
        $isNeg = true;
        $val = substr($val, 1, -1);
    }
    if (substr($val, -1) === '-') {
        $isNeg = true;
        $val = substr($val, 0, -1);
    }
    if (strpos($val, '-') === 0) {
        $isNeg = true;
        $val = substr($val, 1);
    }

    // Detectar si usa coma como decimal
    $hasComma = strpos($val, ',') !== false;
    $hasDot = strpos($val, '.') !== false;

    if ($hasComma && $hasDot) {
        // Formato 1.234,56 -> quitar puntos, cambiar coma por punto
        $val = str_replace('.', '', $val);
        $val = str_replace(',', '.', $val);
    } elseif ($hasComma && !$hasDot) {
        // Formato 1234,56 -> cambiar coma por punto
        $val = str_replace(',', '.', $val);
    } elseif ($hasDot && !$hasComma) {
        // Ya viene con punto decimal estándar (e.g. 1234.56)
    }

    if (!is_numeric($val)) return null;
    $num = (float)$val;
    return $isNeg ? -$num : $num;
}

// Determinar acción
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$rawBody = file_get_contents('php://input');
$jsonBody = json_decode($rawBody, true);
if ($jsonBody && isset($jsonBody['action'])) {
    $action = $jsonBody['action'];
}

// ==============================================================================
// ACCIÓN 1: VALIDATE (Valida un archivo CSV y devuelve reporte detallado)
// ==============================================================================
if ($action === 'validate') {
    $csvContent = '';
    $fileName = 'archivo.csv';

    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $fileName = $_FILES['file']['name'];
        $csvContent = file_get_contents($_FILES['file']['tmp_name']);
    } elseif (!empty($jsonBody['csv_text'])) {
        $csvContent = $jsonBody['csv_text'];
        $fileName = $jsonBody['filename'] ?? 'archivo.csv';
    } elseif (!empty($_POST['csv_text'])) {
        $csvContent = $_POST['csv_text'];
        $fileName = $_POST['filename'] ?? 'archivo.csv';
    } else {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'No se recibió ningún archivo CSV o contenido.']);
        exit;
    }

    // Normalizar codificación UTF-8
    if (!mb_check_encoding($csvContent, 'UTF-8')) {
        $csvContent = mb_convert_encoding($csvContent, 'UTF-8', 'ISO-8859-1, Windows-1252, UTF-8');
    }
    // Remover UTF-8 BOM si existe
    $csvContent = preg_replace('/^\xEF\xBB\xBF/', '', $csvContent);

    // Separar en líneas
    $lines = preg_split('/\r\n|\r|\n/', trim($csvContent));
    if (empty($lines)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'El archivo CSV está vacío.']);
        exit;
    }

    // Detectar delimitador (punto y coma ';' o coma ',')
    $firstLine = $lines[0];
    $countSemicolon = substr_count($firstLine, ';');
    $countComma = substr_count($firstLine, ',');
    $delimiter = ($countSemicolon >= $countComma) ? ';' : ',';

    // Leer encabezados
    $headerRow = str_getcsv($lines[0], $delimiter);
    $headers = [];
    foreach ($headerRow as $idx => $h) {
        $hClean = strtolower(trim($h));
        $hClean = str_replace(['á','é','í','ó','ú','ñ','¤'], ['a','e','i','o','u','n','n'], $hClean);
        $headers[$idx] = $hClean;
    }

    // Mapeo flexible de columnas
    $colMap = [
        'semana' => array_search('semana', $headers),
        'es' => array_search('es', $headers),
        'mes' => array_search('mes', $headers),
        'ano' => array_search('ano', $headers) !== false ? array_search('ano', $headers) : array_search('ano', $headers),
        'clasificacion' => array_search('clasificacion', $headers),
        'fecha' => array_search('fecha', $headers),
        'banco' => array_search('banco', $headers),
        'documento' => array_search('documento', $headers),
        'tipo' => array_search('tipo', $headers),
        'referencia' => array_search('referencia', $headers),
        'monto_bs' => array_search('monto bs', $headers),
        'tasa' => array_search('tasa', $headers),
        'bcv_sap' => array_search('bcv_sap', $headers),
        'monto' => array_search('monto', $headers),
        'division' => array_search('division', $headers),
        'beneficiario' => array_search('beneficiario', $headers),
        'concepto' => array_search('concepto', $headers),
        'texto' => array_search('texto', $headers),
        'concepto1' => array_search('concepto1', $headers),
        'clas' => array_search('clas', $headers),
        'medio_ejecucion' => array_search('medio_ejecucion', $headers),
    ];

    // Verificar columnas mínimas indispensables
    if ($colMap['es'] === false || $colMap['fecha'] === false || $colMap['monto'] === false) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => "El formato del CSV no coincide con 'Formato_Movimientos.csv'. Columnas requeridas no encontradas (es, fecha, monto)."
        ]);
        exit;
    }

    $validationResults = [];
    $validCount = 0;
    $rejectedCount = 0;

    for ($i = 1; $i < count($lines); $i++) {
        $line = trim($lines[$i]);
        if ($line === '') continue; // Ignorar líneas vacías

        $row = str_getcsv($line, $delimiter);
        $rowNum = $i + 1; // 1-indexed número de fila física en el CSV
        $reasons = [];

        // Extraer valores
        $getVal = function($key) use ($colMap, $row) {
            $idx = $colMap[$key] ?? false;
            return ($idx !== false && isset($row[$idx])) ? trim($row[$idx]) : '';
        };

        $raw_es = strtoupper($getVal('es'));
        $raw_fecha = $getVal('fecha');
        $raw_banco = $getVal('banco');
        $raw_documento = $getVal('documento');
        $raw_referencia = $getVal('referencia');
        $raw_monto = $getVal('monto');
        $raw_tasa = $getVal('tasa');
        $raw_bcv_sap = $getVal('bcv_sap');
        $raw_clasificacion = $getVal('clasificacion');
        $raw_medio = $getVal('medio_ejecucion');
        $raw_beneficiario = $getVal('beneficiario');
        $raw_concepto = $getVal('concepto');
        $raw_concepto1 = $getVal('concepto1');
        $raw_texto = $getVal('texto');
        $raw_tipo = $getVal('tipo');
        $raw_division = $getVal('division');
        $raw_mes = strtoupper($getVal('mes'));
        $raw_ano = $getVal('ano');
        $raw_semana = $getVal('semana');
        $raw_clas = $getVal('clas');

        // VALIDACIÓN 1: Tipo de Flujo ('es')
        $clean_es = null;
        if (!in_array($raw_es, ['INGRESO', 'EGRESO'], true)) {
            $reasons[] = "Columna 'es' inválida ('" . ($raw_es ?: 'VACÍO') . "'). Debe ser exactamente INGRESO o EGRESO.";
        } else {
            $clean_es = $raw_es;
        }

        // VALIDACIÓN 2: Fecha
        $clean_fecha = parseDate($raw_fecha);
        if (!$clean_fecha) {
            $reasons[] = "Fecha inválida ('" . ($raw_fecha ?: 'VACÍO') . "'). Debe ser válida con formato DD/MM/AAAA o AAAA-MM-DD.";
        }

        // VALIDACIÓN 3: Banco
        $clean_banco = $raw_banco;
        if ($clean_banco === '') {
            $reasons[] = "Banco obligatorio. La columna 'banco' no puede estar vacía.";
        }

        // VALIDACIÓN 4: Documento o Referencia
        $clean_doc = $raw_documento ?: $raw_referencia;
        if ($clean_doc === '') {
            $reasons[] = "Documento/Referencia obligatorio. Debe indicar un número de documento o referencia.";
        }

        // VALIDACIÓN 5: Monto
        $clean_monto = parseNumber($raw_monto);
        if ($clean_monto === null || $clean_monto == 0) {
            $reasons[] = "Monto inválido o cero ('" . ($raw_monto ?: 'VACÍO') . "'). Debe ser un importe numérico diferente de 0.";
        } else {
            // Normalizar signo según tipo de flujo
            if ($clean_es === 'EGRESO' && $clean_monto > 0) {
                $clean_monto = -$clean_monto;
            } elseif ($clean_es === 'INGRESO' && $clean_monto < 0) {
                $clean_monto = abs($clean_monto);
            }
        }

        // Derivar mes y año si no están provistos
        if ($clean_fecha) {
            $dateParts = explode('-', $clean_fecha);
            if (empty($raw_mes)) {
                $mNum = (int)$dateParts[1];
                $raw_mes = $MESES[$mNum] ?? 'GENERAL';
            }
            if (empty($raw_ano)) {
                $raw_ano = $dateParts[0];
            }
        }

        $isValid = empty($reasons);
        if ($isValid) {
            $validCount++;
        } else {
            $rejectedCount++;
        }

        $cleanData = [
            'es' => $clean_es ?: $raw_es,
            'mes' => $raw_mes ?: 'GENERAL',
            'año' => $raw_ano ?: date('Y'),
            'clasificacion' => $raw_clasificacion ?: 'OPERATIVO',
            'fecha' => $clean_fecha ?: $raw_fecha,
            'banco' => $clean_banco,
            'documento' => $clean_doc,
            'tipo' => $raw_tipo ?: ($clean_es === 'INGRESO' ? 'NC' : 'ND'),
            'referencia' => $raw_referencia ?: $clean_doc,
            'tasa' => parseNumber($raw_tasa),
            'bcv_sap' => parseNumber($raw_bcv_sap),
            'monto' => $clean_monto,
            'division' => $raw_division ?: '',
            'beneficiario' => $raw_beneficiario ?: '',
            'concepto' => $raw_concepto ?: '',
            'texto' => $raw_texto ?: '',
            'concepto1' => $raw_concepto1 ?: '',
            'clas' => $raw_clas ?: '',
            'medio_ejecucion' => $raw_medio ?: 'BANCOS NACIONALES'
        ];

        $validationResults[] = [
            'row_number' => $rowNum,
            'status' => $isValid ? 'valid' : 'rejected',
            'reasons' => $reasons,
            'reason_text' => $isValid ? 'Listo para importar' : implode(' | ', $reasons),
            'data' => $cleanData,
            'raw' => [
                'es' => $raw_es,
                'fecha' => $raw_fecha,
                'banco' => $raw_banco,
                'documento' => $raw_documento,
                'monto' => $raw_monto
            ]
        ];
    }

    echo json_encode([
        'success' => true,
        'filename' => $fileName,
        'total' => count($validationResults),
        'valid_count' => $validCount,
        'rejected_count' => $rejectedCount,
        'rows' => $validationResults
    ]);
    exit;
}

// ==============================================================================
// ACCIÓN 2: COMMIT (Carga definitiva de los registros validados en fc_mov)
// ==============================================================================
if ($action === 'commit') {
    $records = $jsonBody['records'] ?? [];
    $userId = isset($jsonBody['usuario_id']) && is_numeric($jsonBody['usuario_id']) ? (int)$jsonBody['usuario_id'] : 2;

    if (empty($records) || !is_array($records)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'No se enviaron registros válidos para cargar.']);
        exit;
    }

    $totalToInsert = count($records);
    $insertedCount = 0;

    // A. Inserción en SQLite Local dentro de una transacción
    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare("
            INSERT INTO fc_mov (
                es, mes, año, clasificacion, fecha, banco, documento, tipo, referencia,
                tasa, bcv_sap, monto, division, beneficiario, concepto, texto,
                concepto1, clas, medio_ejecucion
            ) VALUES (
                :es, :mes, :ano, :clasificacion, :fecha, :banco, :documento, :tipo, :referencia,
                :tasa, :bcv_sap, :monto, :division, :beneficiario, :concepto, :texto,
                :concepto1, :clas, :medio_ejecucion
            )
        ");

        foreach ($records as $r) {
            $stmt->execute([
                ':es' => $r['es'] ?? null,
                ':mes' => $r['mes'] ?? null,
                ':ano' => $r['año'] ?? ($r['ano'] ?? date('Y')),
                ':clasificacion' => $r['clasificacion'] ?? null,
                ':fecha' => $r['fecha'] ?? null,
                ':banco' => $r['banco'] ?? null,
                ':documento' => $r['documento'] ?? null,
                ':tipo' => $r['tipo'] ?? null,
                ':referencia' => $r['referencia'] ?? null,
                ':tasa' => isset($r['tasa']) && $r['tasa'] !== '' ? (float)$r['tasa'] : null,
                ':bcv_sap' => isset($r['bcv_sap']) && $r['bcv_sap'] !== '' ? (float)$r['bcv_sap'] : null,
                ':monto' => isset($r['monto']) && $r['monto'] !== '' ? (float)$r['monto'] : 0,
                ':division' => $r['division'] ?? null,
                ':beneficiario' => $r['beneficiario'] ?? null,
                ':concepto' => $r['concepto'] ?? null,
                ':texto' => $r['texto'] ?? null,
                ':concepto1' => $r['concepto1'] ?? null,
                ':clas' => $r['clas'] ?? null,
                ':medio_ejecucion' => $r['medio_ejecucion'] ?? 'BANCOS NACIONALES'
            ]);
            $insertedCount++;
        }

        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Error al guardar en base de datos local: ' . $e->getMessage()]);
        exit;
    }

    // B. Sincronización en Supabase fc_mov (en batches de hasta 100 registros)
    $supabaseBatches = array_chunk($records, 100);
    $supSuccessCount = 0;

    foreach ($supabaseBatches as $batch) {
        $supPayload = [];
        foreach ($batch as $r) {
            $supPayload[] = [
                'es' => $r['es'] ?? null,
                'mes' => $r['mes'] ?? null,
                'año' => $r['año'] ?? ($r['ano'] ?? date('Y')),
                'clasificacion' => $r['clasificacion'] ?? null,
                'fecha' => $r['fecha'] ?? null,
                'banco' => $r['banco'] ?? null,
                'documento' => $r['documento'] ?? null,
                'tipo' => $r['tipo'] ?? null,
                'referencia' => $r['referencia'] ?? null,
                'tasa' => isset($r['tasa']) && $r['tasa'] !== '' ? (float)$r['tasa'] : null,
                'bcv_sap' => isset($r['bcv_sap']) && $r['bcv_sap'] !== '' ? (float)$r['bcv_sap'] : null,
                'monto' => isset($r['monto']) && $r['monto'] !== '' ? (float)$r['monto'] : 0,
                'division' => $r['division'] ?? null,
                'beneficiario' => $r['beneficiario'] ?? null,
                'concepto' => $r['concepto'] ?? null,
                'texto' => $r['texto'] ?? null,
                'concepto1' => $r['concepto1'] ?? null,
                'clas' => $r['clas'] ?? null,
                'medio_ejecucion' => $r['medio_ejecucion'] ?? 'BANCOS NACIONALES'
            ];
        }

        $res = callSupabase($supabaseUrl . '/rest/v1/fc_mov', 'POST', $supPayload, $supabaseKey);
        if ($res['code'] >= 200 && $res['code'] < 300) {
            $supSuccessCount += count($batch);
        }
    }

    // C. Registrar auditoría general de la carga en Supabase control_cambios
    $auditSummary = [
        'accion' => 'CARGA_CSV',
        'cantidad_cargada' => $insertedCount,
        'fecha_hora' => date('Y-m-d H:i:s'),
        'primer_registro' => $records[0] ?? null,
        'ultimo_registro' => end($records) ?? null
    ];

    callSupabase(
        $supabaseUrl . '/rest/v1/control_cambios',
        'POST',
        [
            'usuario' => $userId,
            'valor_anterior' => null,
            'valor_nuevo' => json_encode($auditSummary, JSON_UNESCAPED_UNICODE)
        ],
        $supabaseKey
    );

    echo json_encode([
        'success' => true,
        'message' => "Se cargaron exitosamente {$insertedCount} movimientos en la tabla fc_mov.",
        'inserted_count' => $insertedCount,
        'supabase_synced' => $supSuccessCount
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Acción no válida. Especifique action=validate o action=commit.']);
