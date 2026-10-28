<?php
// ==============================================================================
// FlujoCaja Pro - Endpoint CRUD para Movimientos (fc_mov) y Auditoría
// Sincroniza cambios en SQLite local y Supabase, asegurando registro en control_cambios
// ==============================================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

ini_set('display_errors', '0');
error_reporting(E_ALL);

// 1. Conexión a Base de Datos Local SQLite
$db_path = __DIR__ . '/flujocaja.db';
if (!file_exists($db_path)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Base de datos local no encontrada.']);
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
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
    }

    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['code' => $code, 'data' => $response ? json_decode($response, true) : null, 'raw' => $response];
}

// 3. Procesar payload de entrada
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);
if (!$input) {
    $input = $_POST;
}

$action = $input['action'] ?? $_GET['action'] ?? '';
$userId = isset($input['usuario_id']) && is_numeric($input['usuario_id']) ? (int)$input['usuario_id'] : 2; // Default a usuario activo 'vcappugi' (id: 2)

// ==============================================================================
// ACCIÓN: OBTENER DETALLE (GET)
// ==============================================================================
if ($action === 'get') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : (int)($input['id'] ?? 0);
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID de movimiento no proporcionado.']);
        exit;
    }

    $stmt = $pdo->prepare("SELECT * FROM fc_mov WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Movimiento no encontrado.']);
        exit;
    }

    echo json_encode(['success' => true, 'data' => $row]);
    exit;
}

// ==============================================================================
// ACCIÓN: ACTUALIZAR MOVIMIENTO (UPDATE)
// ==============================================================================
if ($action === 'update') {
    $id = isset($input['id']) ? (int)$input['id'] : 0;
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID de movimiento requerido para actualizar.']);
        exit;
    }

    // Obtener registro anterior de la base de datos
    $stmt = $pdo->prepare("SELECT * FROM fc_mov WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $id]);
    $oldRow = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$oldRow) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'El movimiento a actualizar no existe.']);
        exit;
    }

    // REGLA DEL NEGOCIO OBLIGATORIA:
    // No se podrán modificar los campos: ID, Banco, nro de documento
    // Preservamos estrictamente los valores originales:
    $locked_id = (int)$oldRow['id'];
    $locked_banco = $oldRow['banco'];
    $locked_documento = $oldRow['documento'];

    // Campos permitidos y sanitizados
    $fecha = isset($input['fecha']) ? trim($input['fecha']) : $oldRow['fecha'];
    $es = isset($input['es']) ? strtoupper(trim($input['es'])) : $oldRow['es'];
    if (!in_array($es, ['INGRESO', 'EGRESO'])) {
        $es = $oldRow['es'];
    }

    $monto = isset($input['monto']) && is_numeric($input['monto']) ? (float)$input['monto'] : (float)$oldRow['monto'];
    $medio = isset($input['medio_ejecucion']) ? trim($input['medio_ejecucion']) : $oldRow['medio_ejecucion'];
    $clas = isset($input['clasificacion']) ? trim($input['clasificacion']) : $oldRow['clasificacion'];
    $ref = isset($input['referencia']) ? trim($input['referencia']) : $oldRow['referencia'];
    $tasa = (isset($input['tasa']) && is_numeric($input['tasa'])) ? (float)$input['tasa'] : $oldRow['tasa'];
    $bcv_sap = (isset($input['bcv_sap']) && is_numeric($input['bcv_sap'])) ? (float)$input['bcv_sap'] : $oldRow['bcv_sap'];
    $division = isset($input['division']) ? trim($input['division']) : $oldRow['division'];
    $beneficiario = isset($input['beneficiario']) ? trim($input['beneficiario']) : $oldRow['beneficiario'];
    $concepto = isset($input['concepto']) ? trim($input['concepto']) : $oldRow['concepto'];
    $concepto1 = isset($input['concepto1']) ? trim($input['concepto1']) : $oldRow['concepto1'];
    $texto = isset($input['texto']) ? trim($input['texto']) : $oldRow['texto'];
    $mes = isset($input['mes']) ? strtoupper(trim($input['mes'])) : $oldRow['mes'];
    $ano = isset($input['año']) ? trim($input['año']) : (isset($input['ano']) ? trim($input['ano']) : $oldRow['año']);

    // A. Actualizar en SQLite Local (el trigger 'trg_fc_mov_update' registrará en control_cambios)
    $sqlSqlite = "
        UPDATE fc_mov SET
            fecha = :fecha,
            es = :es,
            monto = :monto,
            medio_ejecucion = :medio,
            clasificacion = :clas,
            referencia = :ref,
            tasa = :tasa,
            bcv_sap = :bcv_sap,
            division = :division,
            beneficiario = :beneficiario,
            concepto = :concepto,
            concepto1 = :concepto1,
            texto = :texto,
            mes = :mes,
            año = :ano
        WHERE id = :id
    ";

    $updateParams = [
        ':id' => $locked_id,
        ':fecha' => $fecha,
        ':es' => $es,
        ':monto' => $monto,
        ':medio' => $medio,
        ':clas' => $clas,
        ':ref' => $ref,
        ':tasa' => $tasa,
        ':bcv_sap' => $bcv_sap,
        ':division' => $division,
        ':beneficiario' => $beneficiario,
        ':concepto' => $concepto,
        ':concepto1' => $concepto1,
        ':texto' => $texto,
        ':mes' => $mes,
        ':ano' => $ano
    ];

    try {
        $stmtUpdate = $pdo->prepare($sqlSqlite);
        $stmtUpdate->execute($updateParams);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Error al actualizar base local: ' . $e->getMessage()]);
        exit;
    }

    // B. Obtener el nuevo estado del registro
    $stmtNew = $pdo->prepare("SELECT * FROM fc_mov WHERE id = :id LIMIT 1");
    $stmtNew->execute([':id' => $locked_id]);
    $newRow = $stmtNew->fetch(PDO::FETCH_ASSOC);

    // C. Sincronizar en Supabase (PATCH fc_mov)
    $supabaseUpdatePayload = [
        'fecha' => $fecha,
        'es' => $es,
        'monto' => $monto,
        'medio_ejecucion' => $medio,
        'clasificacion' => $clas,
        'referencia' => $ref,
        'tasa' => $tasa,
        'bcv_sap' => $bcv_sap,
        'division' => $division,
        'beneficiario' => $beneficiario,
        'concepto' => $concepto,
        'concepto1' => $concepto1,
        'texto' => $texto,
        'mes' => $mes,
        'año' => $ano
    ];

    $supUpdateRes = callSupabase(
        $supabaseUrl . '/rest/v1/fc_mov?id=eq.' . $locked_id,
        'PATCH',
        $supabaseUpdatePayload,
        $supabaseKey
    );

    // D. Registrar auditoría en Supabase control_cambios
    $auditPayload = [
        'usuario' => $userId,
        'valor_anterior' => json_encode($oldRow, JSON_UNESCAPED_UNICODE),
        'valor_nuevo' => json_encode($newRow, JSON_UNESCAPED_UNICODE)
    ];

    callSupabase(
        $supabaseUrl . '/rest/v1/control_cambios',
        'POST',
        $auditPayload,
        $supabaseKey
    );

    echo json_encode([
        'success' => true,
        'message' => "Movimiento #$locked_id modificado exitosamente.",
        'data' => $newRow
    ]);
    exit;
}

// ==============================================================================
// ACCIÓN: ELIMINAR MOVIMIENTO (DELETE)
// ==============================================================================
if ($action === 'delete') {
    $id = isset($input['id']) ? (int)$input['id'] : 0;
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID de movimiento requerido para eliminar.']);
        exit;
    }

    // Obtener registro antes de borrar para registro en auditoría
    $stmt = $pdo->prepare("SELECT * FROM fc_mov WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $id]);
    $oldRow = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$oldRow) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'El movimiento a eliminar no existe.']);
        exit;
    }

    // A. Eliminar de SQLite Local (el trigger 'trg_fc_mov_delete' registrará en control_cambios)
    try {
        $stmtDel = $pdo->prepare("DELETE FROM fc_mov WHERE id = :id");
        $stmtDel->execute([':id' => $id]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Error al eliminar en base local: ' . $e->getMessage()]);
        exit;
    }

    // B. Sincronizar en Supabase (DELETE fc_mov)
    callSupabase(
        $supabaseUrl . '/rest/v1/fc_mov?id=eq.' . $id,
        'DELETE',
        null,
        $supabaseKey
    );

    // C. Registrar eliminación en Supabase control_cambios
    $auditPayload = [
        'usuario' => $userId,
        'valor_anterior' => json_encode($oldRow, JSON_UNESCAPED_UNICODE),
        'valor_nuevo' => null
    ];

    callSupabase(
        $supabaseUrl . '/rest/v1/control_cambios',
        'POST',
        $auditPayload,
        $supabaseKey
    );

    echo json_encode([
        'success' => true,
        'message' => "Movimiento #$id eliminado exitosamente."
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Acción CRUD no reconocida. Use get, update o delete.']);
