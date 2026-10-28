# FlujoCaja Pro (admapl_fc) ⚡📊

Sistema integral de analítica, monitoreo, gestión y control de **Flujo de Caja Empresarial**, diseñado con arquitectura híbrida de alto rendimiento (**SQLite local + Supabase Cloud REST API**), interfaz moderna y reactiva, y auditoría completa de transacciones.

---

## 🚀 Características Principales

### 1. Dashboard Ejecutivo y Analítica en Tiempo Real
- **KPIs Dinámicos:** Ingresos totales, egresos, flujo neto y ratio de cobertura de efectivo en dólares ($).
- **Gráficos Reactivos (Chart.js):**
  - Evolución mensual del flujo de caja (ingresos, egresos y flujo neto).
  - Concentración y distribución por entidad bancaria.
  - Distribución por clasificación de gastos (Operativo, Financiero, Inversión).
  - Tendencia de balance neto acumulado.
  - *Todos los gráficos reaccionan instantáneamente a los filtros aplicados.*

### 2. Explorador de Movimientos Avanzado
- Paginación dinámica (25, 50, 100 registros por página).
- Ordenamiento bidireccional por cualquiera de las columnas (Fecha, Tipo, Banco, Beneficiario, Concepto, Documento, Tasa, Monto).
- Barra de filtros dedicados de tabla:
  - Rango de fechas (Fecha Desde / Fecha Hasta).
  - Número de Documento / Referencia.
  - Beneficiario / Cliente.
  - Rango de Monto USD (Mínimo / Máximo).
  - Medio de Ejecución (Bancos Nacionales, Tarjetas, etc.).

### 3. Módulo CRUD con Auditoría (`control_cambios`)
- Ventana modal interactiva para consultar, editar o eliminar movimientos.
- **Campos protegidos y no modificables:** ID, Banco y Nro. de Documento (bloqueados con candado 🔒 por integridad bancaria).
- Sincronización bidireccional entre la base de datos local y Supabase.
- **Triggers automáticos en base de datos:** Cada actualización o eliminación registra el estado anterior y nuevo en la tabla `control_cambios` asociando el usuario activo.

### 4. Carga y Verificación Diagnóstica de CSV
- **Descarga de Plantilla Oficial:** Genera `Plantilla_Movimientos.csv` con los 21 encabezados exactos de `Formato_Movimientos.csv` y codificación UTF-8 con BOM.
- **Modal de Diagnóstico Previo:** Zona Drag & Drop para subir archivos CSV y analizarlos antes de escribir en la base de datos:
  - Valida tipo de flujo (`INGRESO` / `EGRESO`), formato de fecha (`DD/MM/AAAA`), banco obligatorio, documento y monto válido diferente de cero.
  - Tarjetas estadísticas (Total Leídos, Válidos, Rechazados).
  - Pestañas de filtrado: *Todos*, *✅ Válidos* y *❌ Rechazados*.
  - Explicación detallada de los motivos de rechazo por fila.
  - Carga masiva selectiva: Permite procesar únicamente los registros válidos.

### 5. Exportación a Excel con Nomenclatura Dinámica
- Generación de archivos `.xlsx` reales mediante XML nativo sin dependencias externas pesadas.
- Aplica formato condicional (verde para ingresos, rojo para egresos) y encabezados corporativos.
- Nomenclatura inteligente: El nombre del archivo descargado refleja los filtros activos (ej: `movimientos_ENERO_OPERATIVO_BANESCO_2026-10-27.xlsx`).

### 6. Seguridad y Control de Acceso
- Ventana de autenticación con interfaz de cristal atenuada (*glassmorphism*).
- Contraseñas cifradas con hash **Bcrypt** contra la tabla `usuarios` en Supabase.
- Persistencia de sesión segura y botón de cierre de sesión en cabecera.

---

## 🛠️ Tecnologías Empleadas

- **Frontend:** HTML5 semántico, CSS3 Vanilla (tokens de diseño modernos, modo oscuro, diseño responsivo), JavaScript ES6+ (Fetch API, Chart.js).
- **Backend:** PHP 8+ (PDO SQLite, cURL Supabase REST API), Python 3 (scripts de procesamiento y carga masiva).
- **Bases de Datos:**
  - **SQLite:** `flujocaja.db` local optimizada con índices y triggers.
  - **Supabase (PostgreSQL Cloud):** Tablas `fc_mov`, `usuarios` y `control_cambios`.

---

## 📁 Estructura del Proyecto

```text
flujocaja/
├── index.html                 # Vista principal del Dashboard y Explorador
├── style.css                  # Sistema de diseño, paleta de colores y temas
├── app.js                     # Controlador principal de interfaz y eventos
├── config.js                  # Parámetros de conexión frontend a Supabase
├── login.php                  # Endpoint de autenticación y verificación bcrypt
├── analytics.php              # API de agregación y consulta analítica SQLite
├── crud_movimiento.php        # API CRUD para modificar y eliminar movimientos
├── import_csv.php             # Validador y cargador masivo de CSV
├── descargar_plantilla.php    # Descargador de plantilla CSV oficial
├── export_excel.php           # Generador de reportes Excel (.xlsx)
├── load_fc_mov.py             # Script de carga inicial masiva a Supabase
├── clean_csv.py               # Preprocesador y depurador de archivos CSV
├── Formato_Movimientos.csv    # Formato de referencia oficial
├── test_carga_movimientos.csv # Archivo de prueba con casos válidos y rechazados
├── .env.example               # Plantilla de variables de entorno
└── .gitignore                 # Exclusión de archivos masivos y temporales
```

---

## ⚙️ Configuración y Puesta en Marcha

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/vcappugi/admapl_fc.git
   ```
2. **Configurar variables de entorno:**
   Copiar `.env.example` a `.env` y configurar las credenciales de Supabase:
   ```env
   URL=https://usefcdjvclapepzwrzqm.supabase.co
   APIKEY=tu_clave_supabase
   ```
3. **Servidor Web:**
   Ejecutar mediante Apache en XAMPP o servidor PHP local:
   ```bash
   php -S localhost:10000
   ```
4. **Acceso:**
   Abrir `http://localhost:10000/index.html` en el navegador.
