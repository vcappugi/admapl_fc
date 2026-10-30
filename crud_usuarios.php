<?php
// ==============================================================================
// FlujoCaja Pro - Endpoint CRUD para Usuarios (tabla usuarios)
// Soporta gestión completa para administradores con sincronización SQLite y Supabase
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

// 1. Conexión SQLite
$db_path = __DIR__ . '/flujocaja.db';
$pdo = null;
if (file_exists($db_path)) {
    try {
        $pdo = new PDO("sqlite:" . $db_path);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    } catch (Exception $e) {
        // Fallback si SQLite falla
    }
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

function callSupabaseRest($url, $method = 'GET', $body = null, $supabaseKey = '') {
    $ch = curl_init($url);
    $headers = [
        'apikey: ' . $supabaseKey,
        'Authorization: Bearer ' . $supabaseKey,
        'Content-Type: application/json',
        'Prefer: return=representation'
    ];
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
    }
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'data' => json_decode($resp, true), 'raw' => $resp];
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
if (!$action) {
    $rawInput = file_get_contents('php://input');
    if ($rawInput) {
        $parsed = json_decode($rawInput, true);
        if ($parsed && isset($parsed['action'])) {
            $action = $parsed['action'];
            $_POST = array_merge($_POST, $parsed);
        }
    }
}

try {
    switch ($action) {
        case 'list':
            // Consultar Supabase primero
            $supUrl = $supabaseUrl . '/rest/v1/usuarios?select=id,nombre,rol,created_at&order=id.asc';
            $supRes = callSupabaseRest($supUrl, 'GET', null, $supabaseKey);

            if ($supRes['code'] === 200 && is_array($supRes['data'])) {
                echo json_encode(['success' => true, 'data' => $supRes['data']]);
                exit;
            }

            // Respaldo SQLite
            if ($pdo) {
                $stmt = $pdo->query("SELECT id, nombre, rol, created_at FROM usuarios ORDER BY id ASC");
                $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
                echo json_encode(['success' => true, 'data' => $users]);
                exit;
            }

            throw new Exception("No se pudo obtener la lista de usuarios.");

        case 'create':
            $nombre = trim($_POST['nombre'] ?? '');
            $clave = trim($_POST['clave'] ?? '');
            $rol = trim($_POST['rol'] ?? 'usuario');

            if (empty($nombre)) {
                throw new Exception("El nombre de usuario es obligatorio.");
            }
            if (empty($clave)) {
                throw new Exception("La contraseña es obligatoria para nuevos usuarios.");
            }
            if ($rol !== 'admin' && $rol !== 'usuario') {
                throw new Exception("El rol solo puede ser 'admin' o 'usuario'.");
            }

            $hash = password_hash($clave, PASSWORD_BCRYPT);
            $createdAt = date('Y-m-d H:i:s');

            // 1. Guardar en Supabase
            $supPayload = [
                'nombre' => $nombre,
                'clave' => $hash,
                'rol' => $rol,
                'created_at' => (new DateTime())->format(DateTime::ATOM)
            ];
            $supRes = callSupabaseRest($supabaseUrl . '/rest/v1/usuarios', 'POST', $supPayload, $supabaseKey);
            
            $createdUser = null;
            if ($supRes['code'] === 201 && is_array($supRes['data']) && count($supRes['data']) > 0) {
                $createdUser = $supRes['data'][0];
            }

            // 2. Guardar en SQLite
            if ($pdo) {
                try {
                    $stmt = $pdo->prepare("INSERT INTO usuarios (nombre, clave, rol, created_at) VALUES (:n, :c, :r, :ca)");
                    $stmt->execute([':n' => $nombre, ':c' => $hash, ':r' => $rol, ':ca' => $createdAt]);
                    if (!$createdUser) {
                        $createdUser = [
                            'id' => $pdo->lastInsertId(),
                            'nombre' => $nombre,
                            'rol' => $rol,
                            'created_at' => $createdAt
                        ];
                    }
                } catch (Exception $e) {
                    // Ignorar si ya está en Supabase
                }
            }

            echo json_encode([
                'success' => true,
                'message' => 'Usuario creado exitosamente.',
                'user' => $createdUser
            ]);
            break;

        case 'update':
            $id = intval($_POST['id'] ?? 0);
            $nombre = trim($_POST['nombre'] ?? '');
            $clave = trim($_POST['clave'] ?? '');
            $rol = trim($_POST['rol'] ?? 'usuario');

            if ($id <= 0) {
                throw new Exception("ID de usuario no válido.");
            }
            if (empty($nombre)) {
                throw new Exception("El nombre de usuario es obligatorio.");
            }
            if ($rol !== 'admin' && $rol !== 'usuario') {
                throw new Exception("El rol solo puede ser 'admin' o 'usuario'.");
            }

            $updateSup = [
                'nombre' => $nombre,
                'rol' => $rol
            ];
            if (!empty($clave)) {
                $hash = password_hash($clave, PASSWORD_BCRYPT);
                $updateSup['clave'] = $hash;
            }

            // 1. Actualizar en Supabase
            $supRes = callSupabaseRest($supabaseUrl . '/rest/v1/usuarios?id=eq.' . $id, 'PATCH', $updateSup, $supabaseKey);

            // 2. Actualizar en SQLite
            if ($pdo) {
                try {
                    if (!empty($clave)) {
                        $stmt = $pdo->prepare("UPDATE usuarios SET nombre = :n, rol = :r, clave = :c WHERE id = :id");
                        $stmt->execute([':n' => $nombre, ':r' => $rol, ':c' => $hash, ':id' => $id]);
                    } else {
                        $stmt = $pdo->prepare("UPDATE usuarios SET nombre = :n, rol = :r WHERE id = :id");
                        $stmt->execute([':n' => $nombre, ':r' => $rol, ':id' => $id]);
                    }
                } catch (Exception $e) {}
            }

            echo json_encode([
                'success' => true,
                'message' => 'Usuario actualizado correctamente.'
            ]);
            break;

        case 'delete':
            $id = intval($_POST['id'] ?? 0);
            if ($id <= 0) {
                throw new Exception("ID de usuario no válido para eliminar.");
            }

            // 1. Eliminar en Supabase
            $supRes = callSupabaseRest($supabaseUrl . '/rest/v1/usuarios?id=eq.' . $id, 'DELETE', null, $supabaseKey);

            // 2. Eliminar en SQLite
            if ($pdo) {
                try {
                    $stmt = $pdo->prepare("DELETE FROM usuarios WHERE id = :id");
                    $stmt->execute([':id' => $id]);
                } catch (Exception $e) {}
            }

            echo json_encode([
                'success' => true,
                'message' => 'Usuario eliminado correctamente.'
            ]);
            break;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Acción no especificada o inválida.']);
            break;
    }
} catch (Exception $ex) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $ex->getMessage()]);
}
