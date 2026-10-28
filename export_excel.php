<?php
// ==============================================================================
// FlujoCaja Pro - Exportador de Movimientos a Excel (.xlsx) y CSV
// Genera descargas completas y nativas con nombrado dinámico según filtros activos
// ==============================================================================

// Deshabilitar salida de errores en pantalla que puedan corromper el binario
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_time_limit(300);
ini_set('memory_limit', '512M');

$db_path = __DIR__ . '/flujocaja.db';
if (!file_exists($db_path)) {
    header('HTTP/1.1 500 Internal Server Error');
    echo "Base de datos local no encontrada.";
    exit;
}

try {
    $pdo = new PDO("sqlite:" . $db_path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->query("PRAGMA synchronous = NORMAL;");
} catch (Exception $e) {
    header('HTTP/1.1 500 Internal Server Error');
    echo "Error de conexión: " . $e->getMessage();
    exit;
}

// 1. Obtener parámetros de filtros
$es = isset($_GET['es']) ? trim($_GET['es']) : '';
$mes = isset($_GET['mes']) ? trim($_GET['mes']) : '';
$clas = isset($_GET['clasificacion']) ? trim($_GET['clasificacion']) : '';
$banco = isset($_GET['banco']) ? trim($_GET['banco']) : '';
$medio = isset($_GET['medio_ejecucion']) ? trim($_GET['medio_ejecucion']) : '';
$search = isset($_GET['search']) ? trim($_GET['search']) : '';
$dateFrom = isset($_GET['date_from']) ? trim($_GET['date_from']) : '';
$dateTo = isset($_GET['date_to']) ? trim($_GET['date_to']) : '';
$doc = isset($_GET['documento']) ? trim($_GET['documento']) : '';
$benef = isset($_GET['beneficiario']) ? trim($_GET['beneficiario']) : '';
$minMonto = (isset($_GET['min_monto']) && is_numeric($_GET['min_monto'])) ? (float)$_GET['min_monto'] : null;
$maxMonto = (isset($_GET['max_monto']) && is_numeric($_GET['max_monto'])) ? (float)$_GET['max_monto'] : null;
$format = isset($_GET['format']) ? strtolower(trim($_GET['format'])) : 'xlsx';

// Ordenamiento
$allowedSortCols = ['id', 'fecha', 'es', 'banco', 'medio_ejecucion', 'clasificacion', 'documento', 'referencia', 'tasa', 'bcv_sap', 'monto', 'division', 'beneficiario', 'concepto', 'concepto1', 'texto', 'mes', 'año'];
$sortBy = (isset($_GET['sort_by']) && in_array(strtolower($_GET['sort_by']), $allowedSortCols)) ? strtolower($_GET['sort_by']) : 'fecha';
$sortDir = (isset($_GET['sort_dir']) && strtolower($_GET['sort_dir']) === 'asc') ? 'ASC' : 'DESC';

// 2. Construir cláusula WHERE y recolectar etiquetas para el nombre de archivo
$where = [];
$params = [];
$filterNames = [];

if ($es !== '') {
    $where[] = "es = :es";
    $params[':es'] = $es;
    $filterNames[] = preg_replace('/[^a-zA-Z0-9]+/', '_', trim($es));
}
if ($mes !== '') {
    $where[] = "mes = :mes";
    $params[':mes'] = $mes;
    $filterNames[] = preg_replace('/[^a-zA-Z0-9]+/', '_', trim($mes));
}
if ($clas !== '') {
    $where[] = "clasificacion = :clas";
    $params[':clas'] = $clas;
    $filterNames[] = preg_replace('/[^a-zA-Z0-9]+/', '_', trim($clas));
}
if ($banco !== '') {
    $where[] = "banco = :banco";
    $params[':banco'] = $banco;
    $filterNames[] = preg_replace('/[^a-zA-Z0-9]+/', '_', trim($banco));
}
if ($medio !== '') {
    $where[] = "medio_ejecucion = :medio";
    $params[':medio'] = $medio;
    $filterNames[] = preg_replace('/[^a-zA-Z0-9]+/', '_', trim($medio));
}
if ($dateFrom !== '') {
    $where[] = "fecha >= :dateFrom";
    $params[':dateFrom'] = $dateFrom;
    $filterNames[] = "desde_" . str_replace('-', '', $dateFrom);
}
if ($dateTo !== '') {
    $where[] = "fecha <= :dateTo";
    $params[':dateTo'] = $dateTo;
    $filterNames[] = "hasta_" . str_replace('-', '', $dateTo);
}
if ($doc !== '') {
    $where[] = "(documento LIKE :doc OR referencia LIKE :doc)";
    $params[':doc'] = '%' . $doc . '%';
    $filterNames[] = "doc_" . preg_replace('/[^a-zA-Z0-9]+/', '_', trim($doc));
}
if ($benef !== '') {
    $where[] = "beneficiario LIKE :benef";
    $params[':benef'] = '%' . $benef . '%';
    $filterNames[] = "benef_" . substr(preg_replace('/[^a-zA-Z0-9]+/', '_', trim($benef)), 0, 15);
}
if ($minMonto !== null) {
    $where[] = "monto >= :minMonto";
    $params[':minMonto'] = $minMonto;
    $filterNames[] = "min_" . (int)$minMonto;
}
if ($maxMonto !== null) {
    $where[] = "monto <= :maxMonto";
    $params[':maxMonto'] = $maxMonto;
    $filterNames[] = "max_" . (int)$maxMonto;
}
if ($search !== '') {
    $where[] = "(beneficiario LIKE :search OR concepto LIKE :search OR documento LIKE :search OR referencia LIKE :search)";
    $params[':search'] = '%' . $search . '%';
    $filterNames[] = "busq_" . substr(preg_replace('/[^a-zA-Z0-9]+/', '_', trim($search)), 0, 12);
}

// 3. Generar nombre de archivo dinámico: movimientos_[FILTROS_ACTIVOS]_[FECHA]
$filenameParts = ["movimientos"];
if (count($filterNames) > 0) {
    $filenameParts = array_merge($filenameParts, $filterNames);
} else {
    $filenameParts[] = "todos";
}
$filenameParts[] = date('Y-m-d');
$baseName = implode('_', $filenameParts);
// Sanitizar caracteres y consolidar guiones bajos
$cleanFilename = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $baseName);
$cleanFilename = trim(preg_replace('/_+/', '_', $cleanFilename), '_');

// 4. Consultar registros
$whereClause = count($where) > 0 ? "WHERE " . implode(" AND ", $where) : "";
$sql = "
SELECT 
    id, fecha, es, banco, medio_ejecucion, clasificacion,
    documento, referencia, tasa, bcv_sap, monto, division,
    beneficiario, concepto, concepto1, texto, mes, año
FROM fc_mov
$whereClause
ORDER BY $sortBy $sortDir, id DESC
";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

// 5. Generar y enviar formato solicitado

// ==========================================
// FORMATO CSV (con BOM para Excel)
// ==========================================
if ($format === 'csv') {
    header('Content-Type: application/vnd.ms-excel; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $cleanFilename . '.csv"');
    header('Cache-Control: max-age=0, no-cache, must-revalidate, proxy-revalidate');

    echo "\xEF\xBB\xBF"; // UTF-8 BOM
    $out = fopen('php://output', 'w');

    fputcsv($out, [
        'ID', 'Fecha', 'Tipo Flujo', 'Banco', 'Medio Ejecución', 'Clasificación',
        'Nro Documento', 'Referencia', 'Tasa Cambio', 'BCV SAP', 'Monto USD',
        'División', 'Beneficiario / Cliente', 'Concepto', 'Concepto Secundario',
        'Texto / Observación', 'Mes', 'Año'
    ], ';');

    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        fputcsv($out, [
            $row['id'],
            $row['fecha'],
            $row['es'],
            $row['banco'],
            $row['medio_ejecucion'],
            $row['clasificacion'],
            $row['documento'],
            $row['referencia'],
            $row['tasa'] !== null ? number_format((float)$row['tasa'], 2, '.', '') : '',
            $row['bcv_sap'] !== null ? number_format((float)$row['bcv_sap'], 2, '.', '') : '',
            $row['monto'] !== null ? number_format((float)$row['monto'], 2, '.', '') : '0.00',
            $row['division'],
            $row['beneficiario'],
            $row['concepto'],
            $row['concepto1'],
            $row['texto'],
            $row['mes'],
            $row['año']
        ], ';');
    }
    fclose($out);
    exit;
}

// ==========================================
// FORMATO XLSX (Excel Nativo OpenXML)
// ==========================================
$tempBase = sys_get_temp_dir() . '/flujocaja_exp_' . uniqid();
mkdir($tempBase, 0777, true);
mkdir($tempBase . '/_rels', 0777, true);
mkdir($tempBase . '/xl', 0777, true);
mkdir($tempBase . '/xl/_rels', 0777, true);
mkdir($tempBase . '/xl/worksheets', 0777, true);

// 5.1 [Content_Types].xml
$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>';
file_put_contents($tempBase . '/[Content_Types].xml', $contentTypes);

// 5.2 _rels/.rels
$rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>';
file_put_contents($tempBase . '/_rels/.rels', $rootRels);

// 5.3 xl/workbook.xml
$wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Movimientos" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>';
file_put_contents($tempBase . '/xl/workbook.xml', $wbXml);

// 5.4 xl/_rels/workbook.xml.rels
$wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>';
file_put_contents($tempBase . '/xl/_rels/workbook.xml.rels', $wbRels);

// 5.5 xl/styles.xml
// Style 0: Default
// Style 1: Header (Bold, Gray Fill, Center)
// Style 2: Number with 2 decimals (Currency)
// Style 3: Integer
// Style 4: Center text (Date, ES, Mes, Año)
$stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="2">
    <font><name val="Calibri"/><sz val="11"/></font>
    <font><b/><color rgb="FFFFFFFF"/><name val="Calibri"/><sz val="11"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
  </cellXfs>
</styleSheet>';
file_put_contents($tempBase . '/xl/styles.xml', $stylesXml);

// 5.6 xl/worksheets/sheet1.xml
$sheetFile = $tempBase . '/xl/worksheets/sheet1.xml';
$sf = fopen($sheetFile, 'w');

fwrite($sf, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\n");
fwrite($sf, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' . "\n");

// Anchos de columna predefinidos
fwrite($sf, '  <cols>' . "\n");
$colWidths = [
    1 => 10,  // ID
    2 => 14,  // Fecha
    3 => 12,  // Tipo Flujo
    4 => 24,  // Banco
    5 => 24,  // Medio Ejecución
    6 => 18,  // Clasificación
    7 => 18,  // Documento
    8 => 18,  // Referencia
    9 => 14,  // Tasa Cambio
    10 => 14, // BCV SAP
    11 => 18, // Monto USD
    12 => 12, // División
    13 => 36, // Beneficiario
    14 => 36, // Concepto
    15 => 30, // Concepto1
    16 => 30, // Texto
    17 => 14, // Mes
    18 => 10  // Año
];
foreach ($colWidths as $idx => $w) {
    fwrite($sf, '    <col min="' . $idx . '" max="' . $idx . '" width="' . $w . '" customWidth="1"/>' . "\n");
}
fwrite($sf, '  </cols>' . "\n");

fwrite($sf, '  <sheetData>' . "\n");

// Encabezados (Fila 1)
$headers = [
    'A1' => 'ID',
    'B1' => 'Fecha',
    'C1' => 'Tipo Flujo',
    'D1' => 'Banco',
    'E1' => 'Medio Ejecución',
    'F1' => 'Clasificación',
    'G1' => 'Nro Documento',
    'H1' => 'Referencia',
    'I1' => 'Tasa Cambio',
    'J1' => 'BCV SAP',
    'K1' => 'Monto USD',
    'L1' => 'División',
    'M1' => 'Beneficiario / Cliente',
    'N1' => 'Concepto',
    'O1' => 'Concepto Secundario',
    'P1' => 'Texto / Observación',
    'Q1' => 'Mes',
    'R1' => 'Año'
];

fwrite($sf, '    <row r="1" ht="26" customHeight="1">' . "\n");
foreach ($headers as $pos => $name) {
    fwrite($sf, '      <c r="' . $pos . '" t="inlineStr" s="1"><is><t>' . htmlspecialchars($name, ENT_XML1) . '</t></is></c>' . "\n");
}
fwrite($sf, '    </row>' . "\n");

// Escribir datos
$rowNum = 2;
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    fwrite($sf, '    <row r="' . $rowNum . '">' . "\n");

    // A: ID (int, s=3)
    fwrite($sf, '      <c r="A' . $rowNum . '" s="3"><v>' . (int)$row['id'] . '</v></c>' . "\n");

    // B: Fecha (center, s=4)
    $fecha = htmlspecialchars((string)($row['fecha'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="B' . $rowNum . '" t="inlineStr" s="4"><is><t>' . $fecha . '</t></is></c>' . "\n");

    // C: Tipo Flujo (center, s=4)
    $esVal = htmlspecialchars((string)($row['es'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="C' . $rowNum . '" t="inlineStr" s="4"><is><t>' . $esVal . '</t></is></c>' . "\n");

    // D: Banco (text, s=0)
    $bancoVal = htmlspecialchars((string)($row['banco'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="D' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $bancoVal . '</t></is></c>' . "\n");

    // E: Medio Ejecución (text, s=0)
    $medioVal = htmlspecialchars((string)($row['medio_ejecucion'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="E' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $medioVal . '</t></is></c>' . "\n");

    // F: Clasificación (text, s=0)
    $clasVal = htmlspecialchars((string)($row['clasificacion'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="F' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $clasVal . '</t></is></c>' . "\n");

    // G: Documento (text, s=0)
    $docVal = htmlspecialchars((string)($row['documento'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="G' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $docVal . '</t></is></c>' . "\n");

    // H: Referencia (text, s=0)
    $refVal = htmlspecialchars((string)($row['referencia'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="H' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $refVal . '</t></is></c>' . "\n");

    // I: Tasa (number, s=2)
    if ($row['tasa'] !== null && is_numeric($row['tasa'])) {
        fwrite($sf, '      <c r="I' . $rowNum . '" s="2"><v>' . (float)$row['tasa'] . '</v></c>' . "\n");
    } else {
        fwrite($sf, '      <c r="I' . $rowNum . '" s="0"/>' . "\n");
    }

    // J: BCV SAP (number, s=2)
    if ($row['bcv_sap'] !== null && is_numeric($row['bcv_sap'])) {
        fwrite($sf, '      <c r="J' . $rowNum . '" s="2"><v>' . (float)$row['bcv_sap'] . '</v></c>' . "\n");
    } else {
        fwrite($sf, '      <c r="J' . $rowNum . '" s="0"/>' . "\n");
    }

    // K: Monto USD (number, s=2)
    $montoVal = (float)($row['monto'] ?? 0);
    fwrite($sf, '      <c r="K' . $rowNum . '" s="2"><v>' . $montoVal . '</v></c>' . "\n");

    // L: División (center, s=4)
    $divVal = htmlspecialchars((string)($row['division'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="L' . $rowNum . '" t="inlineStr" s="4"><is><t>' . $divVal . '</t></is></c>' . "\n");

    // M: Beneficiario (text, s=0)
    $benefVal = htmlspecialchars((string)($row['beneficiario'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="M' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $benefVal . '</t></is></c>' . "\n");

    // N: Concepto (text, s=0)
    $conVal = htmlspecialchars((string)($row['concepto'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="N' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $conVal . '</t></is></c>' . "\n");

    // O: Concepto1 (text, s=0)
    $con1Val = htmlspecialchars((string)($row['concepto1'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="O' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $con1Val . '</t></is></c>' . "\n");

    // P: Texto (text, s=0)
    $txtVal = htmlspecialchars((string)($row['texto'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="P' . $rowNum . '" t="inlineStr" s="0"><is><t>' . $txtVal . '</t></is></c>' . "\n");

    // Q: Mes (center, s=4)
    $mesVal = htmlspecialchars((string)($row['mes'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="Q' . $rowNum . '" t="inlineStr" s="4"><is><t>' . $mesVal . '</t></is></c>' . "\n");

    // R: Año (center, s=4)
    $anoVal = htmlspecialchars((string)($row['año'] ?? ''), ENT_XML1);
    fwrite($sf, '      <c r="R' . $rowNum . '" t="inlineStr" s="4"><is><t>' . $anoVal . '</t></is></c>' . "\n");

    fwrite($sf, '    </row>' . "\n");
    $rowNum++;
}

fwrite($sf, '  </sheetData>' . "\n");
fwrite($sf, '</worksheet>' . "\n");
fclose($sf);

// 5.7 Empaquetar XLSX como archivo ZIP mediante PharData
$zipPath = sys_get_temp_dir() . '/export_' . uniqid() . '.zip';
if (file_exists($zipPath)) unlink($zipPath);

try {
    $phar = new PharData($zipPath);
    $phar->buildFromDirectory($tempBase);

    $fileSize = filesize($zipPath);

    // Enviar cabeceras de descarga nativa Excel
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $cleanFilename . '.xlsx"');
    header('Content-Length: ' . $fileSize);
    header('Cache-Control: max-age=0, no-cache, must-revalidate, proxy-revalidate');
    header('Pragma: public');

    // Limpiar buffers de salida antes de enviar binario
    while (ob_get_level()) {
        ob_end_clean();
    }

    readfile($zipPath);

    // Limpieza
    unlink($zipPath);
    function deleteDir($dir) {
        if (!is_dir($dir)) return;
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            is_dir($path) ? deleteDir($path) : @unlink($path);
        }
        @rmdir($dir);
    }
    deleteDir($tempBase);
    exit;

} catch (Exception $e) {
    header('HTTP/1.1 500 Internal Server Error');
    echo "Error generando archivo Excel: " . $e->getMessage();
    exit;
}
