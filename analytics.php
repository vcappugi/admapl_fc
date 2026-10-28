<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$db_path = __DIR__ . '/flujocaja.db';
if (!file_exists($db_path)) {
    echo json_encode(['error' => 'Database not found']);
    exit;
}

try {
    $pdo = new PDO("sqlite:" . $db_path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->query("PRAGMA synchronous = NORMAL;");
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
    exit;
}

// Get filter params
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
$minMonto = isset($_GET['min_monto']) && is_numeric($_GET['min_monto']) ? (float)$_GET['min_monto'] : null;
$maxMonto = isset($_GET['max_monto']) && is_numeric($_GET['max_monto']) ? (float)$_GET['max_monto'] : null;

$where = [];
$params = [];

if ($es !== '') {
    $where[] = "es = :es";
    $params[':es'] = $es;
}
if ($mes !== '') {
    $where[] = "mes = :mes";
    $params[':mes'] = $mes;
}
if ($clas !== '') {
    $where[] = "clasificacion = :clas";
    $params[':clas'] = $clas;
}
if ($banco !== '') {
    $where[] = "banco = :banco";
    $params[':banco'] = $banco;
}
if ($medio !== '') {
    $where[] = "medio_ejecucion = :medio";
    $params[':medio'] = $medio;
}
if ($dateFrom !== '') {
    $where[] = "fecha >= :dateFrom";
    $params[':dateFrom'] = $dateFrom;
}
if ($dateTo !== '') {
    $where[] = "fecha <= :dateTo";
    $params[':dateTo'] = $dateTo;
}
if ($doc !== '') {
    $where[] = "(documento LIKE :doc OR referencia LIKE :doc)";
    $params[':doc'] = '%' . $doc . '%';
}
if ($benef !== '') {
    $where[] = "beneficiario LIKE :benef";
    $params[':benef'] = '%' . $benef . '%';
}
if ($minMonto !== null) {
    $where[] = "monto >= :minMonto";
    $params[':minMonto'] = $minMonto;
}
if ($maxMonto !== null) {
    $where[] = "monto <= :maxMonto";
    $params[':maxMonto'] = $maxMonto;
}
if ($search !== '') {
    $where[] = "(beneficiario LIKE :search OR concepto LIKE :search OR documento LIKE :search OR referencia LIKE :search)";
    $params[':search'] = '%' . $search . '%';
}

$whereClause = count($where) > 0 ? "WHERE " . implode(" AND ", $where) : "";

// 1. Overall Totals
$totalsSql = "
SELECT 
    COUNT(*) AS total_registros,
    SUM(CASE WHEN es = 'INGRESO' THEN monto ELSE 0 END) AS total_ingresos,
    SUM(CASE WHEN es = 'EGRESO' THEN ABS(monto) ELSE 0 END) AS total_egresos,
    SUM(CASE WHEN es = 'INGRESO' THEN 1 ELSE 0 END) AS total_ingresos_count,
    SUM(CASE WHEN es = 'EGRESO' THEN 1 ELSE 0 END) AS total_egresos_count,
    AVG(CASE WHEN tasa > 0 AND tasa < 5000 THEN tasa ELSE NULL END) AS tasa_promedio
FROM fc_mov
$whereClause
";
$stmt = $pdo->prepare($totalsSql);
$stmt->execute($params);
$totals = $stmt->fetch(PDO::FETCH_ASSOC);

$totalIngresos = (float)($totals['total_ingresos'] ?? 0);
$totalEgresos = (float)($totals['total_egresos'] ?? 0);
$flujoNeto = $totalIngresos - $totalEgresos;

// 2. Monthly Evolution
$monthOrder = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE'];
$monthlySql = "
SELECT 
    mes,
    SUM(CASE WHEN es = 'INGRESO' THEN monto ELSE 0 END) AS ingresos,
    SUM(CASE WHEN es = 'EGRESO' THEN ABS(monto) ELSE 0 END) AS egresos,
    SUM(CASE WHEN es = 'INGRESO' THEN 1 ELSE 0 END) AS ingresos_count,
    SUM(CASE WHEN es = 'EGRESO' THEN 1 ELSE 0 END) AS egresos_count
FROM fc_mov
$whereClause
GROUP BY mes
";
$stmt = $pdo->prepare($monthlySql);
$stmt->execute($params);
$monthlyRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
$monthlyMap = [];
foreach ($monthlyRows as $r) {
    $monthlyMap[$r['mes']] = $r;
}

$monthlyList = [];
foreach ($monthOrder as $m) {
    if (isset($monthlyMap[$m])) {
        $r = $monthlyMap[$m];
        $ing = (float)($r['ingresos'] ?? 0);
        $egr = (float)($r['egresos'] ?? 0);
        $monthlyList[] = [
            'mes' => $m,
            'ingresos' => round($ing, 2),
            'egresos' => round($egr, 2),
            'neto' => round($ing - $egr, 2),
            'ingresos_count' => (int)($r['ingresos_count'] ?? 0),
            'egresos_count' => (int)($r['egresos_count'] ?? 0)
        ];
    } else {
        $monthlyList[] = [
            'mes' => $m,
            'ingresos' => 0.0,
            'egresos' => 0.0,
            'neto' => 0.0,
            'ingresos_count' => 0,
            'egresos_count' => 0
        ];
    }
}

// 3. Top Banks
$bancosSql = "
SELECT 
    banco,
    SUM(ABS(monto)) AS monto,
    COUNT(*) AS count
FROM fc_mov
$whereClause AND banco IS NOT NULL AND banco != ''
GROUP BY banco
ORDER BY monto DESC
LIMIT 6
";
// If where clause is empty, use WHERE banco IS NOT NULL
if ($whereClause === "") {
    $bancosSql = "
    SELECT banco, SUM(ABS(monto)) AS monto, COUNT(*) AS count
    FROM fc_mov
    WHERE banco IS NOT NULL AND banco != ''
    GROUP BY banco
    ORDER BY monto DESC
    LIMIT 6
    ";
}
$stmt = $pdo->prepare($bancosSql);
$stmt->execute($params);
$topBancos = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $b) {
    $topBancos[] = [
        'banco' => $b['banco'],
        'monto' => round((float)$b['monto'], 2),
        'count' => (int)$b['count']
    ];
}

// 4. Classifications
$clasSql = "
SELECT 
    clasificacion,
    SUM(ABS(monto)) AS monto,
    COUNT(*) AS count
FROM fc_mov
$whereClause AND clasificacion IS NOT NULL AND clasificacion != ''
GROUP BY clasificacion
ORDER BY monto DESC
";
if ($whereClause === "") {
    $clasSql = "
    SELECT clasificacion, SUM(ABS(monto)) AS monto, COUNT(*) AS count
    FROM fc_mov
    WHERE clasificacion IS NOT NULL AND clasificacion != ''
    GROUP BY clasificacion
    ORDER BY monto DESC
    ";
}
$stmt = $pdo->prepare($clasSql);
$stmt->execute($params);
$clasificaciones = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $clasificaciones[] = [
        'clasificacion' => $c['clasificacion'],
        'monto' => round((float)$c['monto'], 2),
        'count' => (int)$c['count']
    ];
}

$response = [
    'total_registros' => (int)$totals['total_registros'],
    'total_ingresos' => round($totalIngresos, 2),
    'total_egresos' => round($totalEgresos, 2),
    'flujo_neto' => round($flujoNeto, 2),
    'total_ingresos_count' => (int)$totals['total_ingresos_count'],
    'total_egresos_count' => (int)$totals['total_egresos_count'],
    'tasa_promedio' => round((float)($totals['tasa_promedio'] ?? 0), 2),
    'mensual' => $monthlyList,
    'top_bancos' => $topBancos,
    'clasificaciones' => $clasificaciones,
    'meses_disponibles' => $monthOrder
];

echo json_encode($response, JSON_UNESCAPED_UNICODE);
