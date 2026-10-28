<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// 1. Read .env for Supabase credentials
$envFile = __DIR__ . '/.env';
$supabaseUrl = 'https://usefcdjvclapepzwrzqm.supabase.co';
$supabaseKey = 'sb_publishable_yg_bXwB_Ul1noXV_0jqUcg_IrNa1gy0';

if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line && $line[0] !== '#' && strpos($line, '=') !== false) {
            list($key, $val) = explode('=', $line, 2);
            $key = trim($key);
            $val = trim(trim($val), "'\"");
            if ($key === 'URL') $supabaseUrl = rtrim($val, '/');
            if ($key === 'APIKEY') $supabaseKey = $val;
        }
    }
}

// 2. Parse input JSON or POST
$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
if (!$data) {
    $data = $_POST;
}

$action = $data['action'] ?? $_GET['action'] ?? 'login';

if ($action === 'login') {
    $usuario = trim($data['usuario'] ?? '');
    $clave = trim($data['clave'] ?? '');

    if (empty($usuario) || empty($clave)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Por favor ingrese usuario y clave.']);
        exit;
    }

    $userRecord = null;

    // A. Query Supabase directly
    $apiUrl = $supabaseUrl . '/rest/v1/usuarios?nombre=eq.' . urlencode($usuario) . '&select=id,nombre,clave,created_at&limit=1';
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'apikey: ' . $supabaseKey,
        'Authorization: Bearer ' . $supabaseKey,
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $users = json_decode($response, true);
        if (is_array($users) && count($users) > 0) {
            $userRecord = $users[0];
        }
    }

    // B. Fallback to local DB if Supabase query failed or returned empty
    if (!$userRecord) {
        $dbPath = __DIR__ . '/flujocaja.db';
        if (file_exists($dbPath)) {
            try {
                $pdo = new PDO("sqlite:" . $dbPath);
                $stmt = $pdo->prepare("SELECT id, nombre, clave, created_at FROM usuarios WHERE nombre = :nombre LIMIT 1");
                $stmt->execute([':nombre' => $usuario]);
                $userRecord = $stmt->fetch(PDO::FETCH_ASSOC);
            } catch (Exception $e) {
                // ignore
            }
        }
    }

    if (!$userRecord || empty($userRecord['clave'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Usuario o clave incorrectos.']);
        exit;
    }

    // Verify encrypted password
    if (password_verify($clave, $userRecord['clave'])) {
        $token = bin2hex(random_bytes(24));
        echo json_encode([
            'success' => true,
            'message' => 'Autenticación exitosa',
            'token' => $token,
            'user' => [
                'id' => $userRecord['id'],
                'nombre' => $userRecord['nombre'],
                'created_at' => $userRecord['created_at']
            ]
        ]);
        exit;
    } else {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Usuario o clave incorrectos.']);
        exit;
    }
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Acción no válida']);
