<?php
// ==============================================================================
// Descarga de Plantilla CSV para Carga de Movimientos
// ==============================================================================

header('Content-Type: text/csv; charset=UTF-8');
header('Content-Disposition: attachment; filename="Plantilla_Movimientos.csv"');
header('Cache-Control: max-age=0, no-cache, must-revalidate, proxy-revalidate');
header('Pragma: public');

// UTF-8 BOM para compatibilidad con Microsoft Excel
echo "\xEF\xBB\xBF";

$out = fopen('php://output', 'w');

// Encabezados exactos según Formato_Movimientos.csv
fputcsv($out, [
    'SEMANA',
    'es',
    'mes',
    'año',
    'clasificacion',
    'fecha',
    'banco',
    'documento',
    'tipo',
    'referencia',
    'Monto BS',
    'tasa',
    'bcv_sap',
    'monto',
    'division',
    'beneficiario',
    'concepto',
    'texto',
    'concepto1',
    'clas',
    'medio_ejecucion'
], ';');

// Fila de ejemplo 1: INGRESO
fputcsv($out, [
    '',
    'INGRESO',
    'ENERO',
    '2026',
    'OPERATIVO',
    '02/01/2026',
    'BANESCO 995',
    '1100188942',
    'NC',
    '34044646',
    '100.000,00',
    '301,37',
    '332',
    '331,82',
    '1208',
    '34044646',
    'ANTICIPO RECIBIDO DE CLIENTES',
    'PAGO CUOTA 1 CLIENTE 34044646',
    'ANTICIPO RECIBIDO DE CLIENTES',
    'MAC',
    'BANCOS NACIONALES'
], ';');

// Fila de ejemplo 2: EGRESO
fputcsv($out, [
    '',
    'EGRESO',
    'ENERO',
    '2026',
    'OPERATIVO',
    '05/01/2026',
    'BNC 045',
    '1100196666',
    'ND',
    'REF-98765',
    '-131.981,20',
    '355,55',
    '355,55',
    '-370,87',
    '1208',
    'EXCELLENCE HOTELES',
    'HOSPEDAJE PERSONAL',
    'FACTURA 0393 HOSPEDAJE',
    'GASTOS DE PERSONAL',
    'MPD',
    'BANCOS NACIONALES'
], ';');

fclose($out);
exit;
