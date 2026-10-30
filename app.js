/**
 * FlujoCaja Pro - Dashboard Controller & Supabase Integration
 */

let supabaseClient = null;
let charts = {};
let currentSummary = null;

// Filter & Pagination State
const state = {
  page: 1,
  pageSize: 25,
  totalRecords: 0,
  sortBy: 'fecha',
  sortAsc: false,
  filters: {
    search: '',
    es: '',
    mes: '',
    clasificacion: '',
    banco: '',
    medio_ejecucion: '',
    dateFrom: '',
    dateTo: '',
    documento: '',
    beneficiario: '',
    minAmount: null,
    maxAmount: null
  }
};

// Utilities
const formatCurrency = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '$ 0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return new Intl.NumberFormat('es-VE').format(num);
};

const escapeHTML = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

// Función auxiliar para desencriptar y obtener credenciales desde configsb.js
function getSupabaseConfig() {
  if (window.CONFIG_SB && typeof window.CONFIG_SB.getCredentials === 'function') {
    return window.CONFIG_SB.getCredentials();
  }
  if (window.CONFIG) {
    return window.CONFIG;
  }
  return null;
}

// Initialize Supabase Client (Desencripta las credenciales de configsb.js en runtime)
function initSupabase() {
  const config = getSupabaseConfig();
  if (!config || !config.SUPABASE_URL || !config.SUPABASE_KEY) {
    console.error('Configuración de Supabase no encontrada o no se pudo desencriptar desde configsb.js');
    showStatus(false, 'Error de Configuración');
    return false;
  }
  try {
    supabaseClient = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_KEY
    );
    console.log('✅ Supabase Client inicializado exitosamente con credenciales desencriptadas desde configsb.js');
    return true;
  } catch (err) {
    console.error('Error inicializando Supabase Client:', err);
    showStatus(false, 'Error de Conexión');
    return false;
  }
}


// Check Connection & Latency
async function checkSupabaseConnection() {
  const startTime = performance.now();
  try {
    const { count, error } = await supabaseClient
      .from('fc_mov')
      .select('id', { count: 'exact', head: true });

    if (error) throw error;
    const latency = Math.round(performance.now() - startTime);
    showStatus(true, `En Línea • ${latency}ms (${formatNumber(count)} reg)`);
    return count;
  } catch (err) {
    console.warn('Error testeando conexión directa a Supabase:', err);
    showStatus(false, 'Desconectado');
    return null;
  }
}

function showStatus(online, text) {
  const badge = document.getElementById('connection-status');
  if (!badge) return;
  const dot = badge.querySelector('.status-dot');
  const label = badge.querySelector('.status-text');
  
  if (online) {
    badge.style.background = 'rgba(16, 185, 129, 0.1)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
    badge.style.color = '#34d399';
    if (dot) dot.style.backgroundColor = 'var(--emerald-primary)';
  } else {
    badge.style.background = 'rgba(244, 63, 94, 0.1)';
    badge.style.borderColor = 'rgba(244, 63, 94, 0.25)';
    badge.style.color = '#fb7185';
    if (dot) dot.style.backgroundColor = 'var(--rose-primary)';
  }
  if (label) label.textContent = text;
}

// Load Summary for KPIs & Charts
async function loadSummaryData() {
  try {
    const resp = await fetch('summary.json');
    if (!resp.ok) throw new Error('No se pudo cargar summary.json');
    currentSummary = await resp.json();
    renderKpis(currentSummary);
    initCharts(currentSummary);
    populateFilterDropdowns(currentSummary);
  } catch (err) {
    console.warn('No se pudo cargar summary.json, cargando dinámico desde Supabase...', err);
  }
}

// Update Charts & KPIs when filters change
async function updateAnalytics() {
  const hasFilter = Boolean(
    state.filters.search ||
    state.filters.es ||
    state.filters.mes ||
    state.filters.clasificacion ||
    state.filters.banco ||
    state.filters.medio_ejecucion ||
    state.filters.dateFrom ||
    state.filters.dateTo ||
    state.filters.documento ||
    state.filters.beneficiario ||
    state.filters.minAmount !== null ||
    state.filters.maxAmount !== null
  );

  // If no filters active, restore global cached summary instantly
  if (!hasFilter && currentSummary) {
    renderKpis(currentSummary);
    initCharts(currentSummary);
    return;
  }

  const params = new URLSearchParams();
  if (state.filters.search) params.append('search', state.filters.search);
  if (state.filters.es) params.append('es', state.filters.es);
  if (state.filters.mes) params.append('mes', state.filters.mes);
  if (state.filters.clasificacion) params.append('clasificacion', state.filters.clasificacion);
  if (state.filters.banco) params.append('banco', state.filters.banco);
  if (state.filters.medio_ejecucion) params.append('medio_ejecucion', state.filters.medio_ejecucion);
  if (state.filters.dateFrom) params.append('date_from', state.filters.dateFrom);
  if (state.filters.dateTo) params.append('date_to', state.filters.dateTo);
  if (state.filters.documento) params.append('documento', state.filters.documento);
  if (state.filters.beneficiario) params.append('beneficiario', state.filters.beneficiario);
  if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) params.append('min_monto', state.filters.minAmount);
  if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) params.append('max_monto', state.filters.maxAmount);

  try {
    const resp = await fetch(`analytics.php?${params.toString()}`);
    if (!resp.ok) throw new Error('Error al consultar analytics.php: ' + resp.status);
    const filteredSummary = await resp.json();
    renderKpis(filteredSummary);
    initCharts(filteredSummary);
  } catch (err) {
    console.warn('No se pudo actualizar analítica dinámica:', err);
  }
}

// Render Top KPI Cards
function renderKpis(summary) {
  if (!summary) return;
  
  // Flujo Neto
  const netEl = document.getElementById('kpi-net-cash');
  const netBadge = document.getElementById('kpi-net-badge');
  if (netEl) netEl.textContent = formatCurrency(summary.flujo_neto);
  if (netBadge) {
    if (summary.flujo_neto >= 0) {
      netBadge.className = 'badge-trend positive';
      netBadge.innerHTML = '▲ Superávit Operativo';
    } else {
      netBadge.className = 'badge-trend negative';
      netBadge.innerHTML = '▼ Déficit Operativo';
    }
  }

  // Total Ingresos
  const incEl = document.getElementById('kpi-income');
  const incCount = document.getElementById('kpi-income-count');
  if (incEl) incEl.textContent = formatCurrency(summary.total_ingresos);
  if (incCount) incCount.textContent = `${formatNumber(summary.total_ingresos_count)} transacciones`;

  // Total Egresos
  const expEl = document.getElementById('kpi-expenses');
  const expCount = document.getElementById('kpi-expenses-count');
  if (expEl) expEl.textContent = formatCurrency(summary.total_egresos);
  if (expCount) expCount.textContent = `${formatNumber(summary.total_egresos_count)} transacciones`;

  // Tasa Promedio
  const bcvEl = document.getElementById('kpi-bcv');
  if (bcvEl) bcvEl.textContent = `${summary.tasa_promedio.toFixed(2)} Bs/$`;

  // Volumen Total
  const volEl = document.getElementById('kpi-volume');
  if (volEl) volEl.textContent = formatNumber(summary.total_registros);
}

// Initialize Charts with Chart.js
function initCharts(summary) {
  if (!summary || typeof Chart === 'undefined') return;

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

  // 1. Monthly Flow Chart (Ingresos vs Egresos)
  const ctxMonthly = document.getElementById('chart-monthly');
  if (ctxMonthly) {
    if (charts.monthly) charts.monthly.destroy();
    
    const labels = summary.mensual.map(m => m.mes);
    const ingresos = summary.mensual.map(m => m.ingresos);
    const egresos = summary.mensual.map(m => m.egresos);
    const neto = summary.mensual.map(m => m.neto);

    charts.monthly = new Chart(ctxMonthly, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Ingresos ($)',
            data: ingresos,
            backgroundColor: 'rgba(16, 185, 129, 0.75)',
            borderColor: '#10b981',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 32
          },
          {
            label: 'Egresos ($)',
            data: egresos,
            backgroundColor: 'rgba(244, 63, 94, 0.75)',
            borderColor: '#f43f5e',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 32
          },
          {
            label: 'Flujo Neto ($)',
            data: neto,
            type: 'line',
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
            pointBackgroundColor: '#38bdf8',
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.04)' } },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: {
              callback: (val) => '$' + (val / 1000000).toFixed(0) + 'M'
            }
          }
        }
      }
    });
  }

  // 2. Top Banks Distribution Chart (Doughnut)
  const ctxBanks = document.getElementById('chart-banks');
  if (ctxBanks) {
    if (charts.banks) charts.banks.destroy();
    
    const bankLabels = summary.top_bancos.slice(0, 6).map(b => b.banco);
    const bankAmounts = summary.top_bancos.slice(0, 6).map(b => b.monto);

    charts.banks = new Chart(ctxBanks, {
      type: 'doughnut',
      data: {
        labels: bankLabels,
        datasets: [{
          data: bankAmounts,
          backgroundColor: [
            '#6366f1',
            '#10b981',
            '#06b6d4',
            '#f59e0b',
            '#f43f5e',
            '#8b5cf6'
          ],
          borderColor: '#0f172a',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
            }
          }
        },
        cutout: '68%'
      }
    });
  }

  // 3. Classification Chart (Horizontal Bar)
  const ctxClas = document.getElementById('chart-classification');
  if (ctxClas) {
    if (charts.clas) charts.clas.destroy();
    
    const clasLabels = summary.clasificaciones.map(c => c.clasificacion);
    const clasAmounts = summary.clasificaciones.map(c => c.monto);

    charts.clas = new Chart(ctxClas, {
      type: 'bar',
      data: {
        labels: clasLabels,
        datasets: [{
          label: 'Volumen ($)',
          data: clasAmounts,
          backgroundColor: [
            'rgba(99, 102, 241, 0.8)',
            'rgba(6, 182, 212, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(16, 185, 129, 0.8)'
          ],
          borderRadius: 6,
          maxBarThickness: 24
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Volumen: ${formatCurrency(ctx.parsed.x)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { callback: (val) => '$' + (val / 1000000).toFixed(0) + 'M' }
          },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // 4. Cumulative Flow Trend
  const ctxTrend = document.getElementById('chart-trend');
  if (ctxTrend) {
    if (charts.trend) charts.trend.destroy();

    let cumulative = 0;
    const cumData = summary.mensual.map(m => {
      cumulative += m.neto;
      return cumulative;
    });

    charts.trend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: summary.mensual.map(m => m.mes),
        datasets: [{
          label: 'Flujo Neto Acumulado ($)',
          data: cumData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointBackgroundColor: '#10b981',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `Acumulado: ${formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.04)' } },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { callback: (val) => '$' + (val / 1000000).toFixed(1) + 'M' }
          }
        }
      }
    });
  }
}

// Populate Filter Dropdowns
function populateFilterDropdowns(summary) {
  // Meses
  const selectMes = document.getElementById('filter-mes');
  if (selectMes && summary.meses_disponibles) {
    summary.meses_disponibles.forEach(mes => {
      const opt = document.createElement('option');
      opt.value = mes;
      opt.textContent = mes;
      selectMes.appendChild(opt);
    });
  }

  // Clasificaciones
  const selectClas = document.getElementById('filter-clas');
  if (selectClas && summary.clasificaciones) {
    summary.clasificaciones.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.clasificacion;
      opt.textContent = c.clasificacion;
      selectClas.appendChild(opt);
    });
  }

  // Bancos
  const selectBanco = document.getElementById('filter-banco');
  if (selectBanco && summary.top_bancos) {
    summary.top_bancos.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.banco;
      opt.textContent = `${b.banco} (${formatNumber(b.count)})`;
      selectBanco.appendChild(opt);
    });
  }

  // Medios de Ejecución
  const selectMedio = document.getElementById('filter-medio');
  if (selectMedio && summary.medios_ejecucion) {
    summary.medios_ejecucion.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      selectMedio.appendChild(opt);
    });
  }
}

// Fetch and Render Live Table Rows from Supabase
async function fetchTableData() {
  if (!supabaseClient) return;

  const tableBody = document.getElementById('table-body');
  const counterBadge = document.getElementById('table-counter');
  
  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px;">
          <div style="display: inline-flex; align-items: center; gap: 10px; color: var(--text-dim);">
            <div class="spinner"></div> Cargando datos en vivo desde Supabase...
          </div>
        </td>
      </tr>
    `;
  }

  try {
    let query = supabaseClient
      .from('fc_mov')
      .select('*', { count: 'exact' });

    // Apply Filters
    if (state.filters.es) {
      query = query.eq('es', state.filters.es);
    }
    if (state.filters.mes) {
      query = query.eq('mes', state.filters.mes);
    }
    if (state.filters.clasificacion) {
      query = query.eq('clasificacion', state.filters.clasificacion);
    }
    if (state.filters.banco) {
      query = query.eq('banco', state.filters.banco);
    }
    if (state.filters.medio_ejecucion) {
      query = query.eq('medio_ejecucion', state.filters.medio_ejecucion);
    }
    if (state.filters.dateFrom) {
      query = query.gte('fecha', state.filters.dateFrom);
    }
    if (state.filters.dateTo) {
      query = query.lte('fecha', state.filters.dateTo);
    }
    if (state.filters.documento) {
      const docTerm = `%${state.filters.documento}%`;
      query = query.or(`documento.ilike.${docTerm},referencia.ilike.${docTerm}`);
    }
    if (state.filters.beneficiario) {
      query = query.ilike('beneficiario', `%${state.filters.beneficiario}%`);
    }
    if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) {
      query = query.gte('monto', state.filters.minAmount);
    }
    if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) {
      query = query.lte('monto', state.filters.maxAmount);
    }
    if (state.filters.search) {
      const term = `%${state.filters.search}%`;
      query = query.or(`beneficiario.ilike.${term},concepto.ilike.${term},documento.ilike.${term},referencia.ilike.${term}`);
    }

    // Apply Sorting
    query = query.order(state.sortBy, { ascending: state.sortAsc, nullsFirst: false });

    // Apply Pagination Range
    const from = (state.page - 1) * state.pageSize;
    const to = from + state.pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    state.totalRecords = count || 0;
    if (counterBadge) {
      counterBadge.textContent = `${formatNumber(state.totalRecords)} registros`;
    }

    renderTableRows(data);
    renderPagination();

  } catch (err) {
    console.error('Error consultando Supabase:', err);
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 40px; color: var(--rose-primary);">
            Error cargando datos de Supabase: ${err.message || err}
          </td>
        </tr>
      `;
    }
  }
}

// Render Table Rows
function renderTableRows(rows) {
  const tableBody = document.getElementById('table-body');
  if (!tableBody) return;

  state.currentTableRows = rows || [];

  if (!rows || rows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <p>No se encontraron movimientos con los filtros seleccionados.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = rows.map(r => {
    const isIngreso = (r.es || '').toUpperCase() === 'INGRESO';
    const flowClass = isIngreso ? 'ingreso' : 'egreso';
    const flowBadge = isIngreso 
      ? '<span class="badge-flow ingreso">↑ Ingreso</span>' 
      : '<span class="badge-flow egreso">↓ Egreso</span>';

    const safeBeneficiario = escapeHtml(r.beneficiario || '-');
    const safeConcepto = escapeHtml(r.concepto || '-');
    const safeBanco = escapeHtml(r.banco || '-');
    const safeDoc = escapeHtml(r.documento || r.referencia || '-');

    return `
      <tr onclick="openTransactionModalById(${r.id})" style="cursor: pointer;">
        <td class="date-cell">${formatDate(r.fecha)}</td>
        <td>${flowBadge}</td>
        <td><strong>${safeBanco}</strong></td>
        <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis;" title="${safeBeneficiario}">
          ${safeBeneficiario}
        </td>
        <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted);" title="${safeConcepto}">
          ${safeConcepto}
        </td>
        <td class="date-cell" style="font-size: 11px;">${safeDoc}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">
          ${r.tasa ? `${r.tasa.toFixed(2)}` : '-'}
        </td>
        <td class="amount-cell ${flowClass}">
          ${formatCurrency(r.monto)}
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openTransactionModalById(${r.id})" style="padding: 4px 10px; font-size: 11px;" title="Ver detalle o modificar este movimiento">
            ✏️ Detalle
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Pagination Controls
function renderPagination() {
  const container = document.getElementById('pagination-controls');
  const info = document.getElementById('pagination-info');
  if (!container) return;

  const totalPages = Math.ceil(state.totalRecords / state.pageSize) || 1;
  const startRow = state.totalRecords === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const endRow = Math.min(state.page * state.pageSize, state.totalRecords);

  if (info) {
    info.textContent = `Mostrando ${formatNumber(startRow)} a ${formatNumber(endRow)} de ${formatNumber(state.totalRecords)} movimientos`;
  }

  let html = '';
  // First & Prev
  html += `<button class="page-btn" onclick="changePage(1)" ${state.page === 1 ? 'disabled' : ''}>«</button>`;
  html += `<button class="page-btn" onclick="changePage(${state.page - 1})" ${state.page === 1 ? 'disabled' : ''}>‹</button>`;

  // Numbered pages (max 5 around current)
  let startP = Math.max(1, state.page - 2);
  let endP = Math.min(totalPages, startP + 4);
  if (endP - startP < 4) {
    startP = Math.max(1, endP - 4);
  }

  for (let p = startP; p <= endP; p++) {
    html += `<button class="page-btn ${p === state.page ? 'active' : ''}" onclick="changePage(${p})">${p}</button>`;
  }

  // Next & Last
  html += `<button class="page-btn" onclick="changePage(${state.page + 1})" ${state.page === totalPages ? 'disabled' : ''}>›</button>`;
  html += `<button class="page-btn" onclick="changePage(${totalPages})" ${state.page === totalPages ? 'disabled' : ''}>»</button>`;

  container.innerHTML = html;
}

function changePage(newPage) {
  const totalPages = Math.ceil(state.totalRecords / state.pageSize) || 1;
  if (newPage < 1 || newPage > totalPages) return;
  state.page = newPage;
  fetchTableData();
}

// Variable to store current editing item
let currentEditingItem = null;

// Helper to show alert inside the modal
function showModalAlert(type, message) {
  const alertBox = document.getElementById('modal-alert');
  const alertIcon = document.getElementById('modal-alert-icon');
  const alertText = document.getElementById('modal-alert-text');
  if (!alertBox || !alertText) return;

  alertBox.className = `modal-alert ${type}`;
  alertIcon.textContent = type === 'success' ? '✅' : '⚠️';
  alertText.textContent = message;
  alertBox.style.display = 'flex';
}

function hideModalAlert() {
  const alertBox = document.getElementById('modal-alert');
  if (alertBox) alertBox.style.display = 'none';
}

// Open modal by ID from state.currentTableRows
window.openTransactionModalById = function(id) {
  const row = (state.currentTableRows || []).find(x => x.id === id);
  if (row) {
    window.openTransactionModal(row);
  }
};

// Transaction Detail / CRUD Modal
window.openTransactionModal = function(data) {
  const modal = document.getElementById('detail-modal');
  if (!modal || !data) return;

  currentEditingItem = data;
  hideModalAlert();

  // Reset loading indicators on buttons
  const saveBtn = document.getElementById('modal-btn-save');
  const saveText = document.getElementById('modal-save-text');
  const saveSpinner = document.getElementById('modal-save-spinner');
  if (saveBtn) saveBtn.disabled = false;
  if (saveText) saveText.textContent = '💾 Guardar Cambios';
  if (saveSpinner) saveSpinner.style.display = 'none';

  const deleteBtn = document.getElementById('modal-btn-delete');
  if (deleteBtn) {
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = '🗑️ Eliminar Movimiento';
  }

  // Header Title and Flow Badge
  const title = document.getElementById('modal-title');
  if (title) title.textContent = `Detalle y Edición de Movimiento #${data.id}`;

  const isIngreso = (data.es || '').toUpperCase() === 'INGRESO';
  const flowBadge = document.getElementById('modal-flow-badge');
  if (flowBadge) {
    flowBadge.innerHTML = isIngreso
      ? '<span class="badge-flow ingreso">↑ Ingreso</span>'
      : '<span class="badge-flow egreso">↓ Egreso</span>';
  }

  // Populate Form Fields
  // PROTECTED (LOCKED) FIELDS: ID, Banco, Documento
  const elId = document.getElementById('modal-input-id');
  if (elId) elId.value = data.id || '';

  const elBanco = document.getElementById('modal-input-banco');
  if (elBanco) elBanco.value = data.banco || '';

  const elDoc = document.getElementById('modal-input-documento');
  if (elDoc) elDoc.value = data.documento || '';

  // EDITABLE FIELDS
  const elFecha = document.getElementById('modal-input-fecha');
  if (elFecha) elFecha.value = data.fecha || '';

  const elEs = document.getElementById('modal-input-es');
  if (elEs) elEs.value = (data.es || 'INGRESO').toUpperCase();

  const elMonto = document.getElementById('modal-input-monto');
  if (elMonto) elMonto.value = (data.monto !== null && data.monto !== undefined) ? data.monto : '';

  const elMedio = document.getElementById('modal-input-medio');
  if (elMedio) elMedio.value = data.medio_ejecucion || '';

  const elClas = document.getElementById('modal-input-clas');
  if (elClas) elClas.value = data.clasificacion || '';

  const elRef = document.getElementById('modal-input-referencia');
  if (elRef) elRef.value = data.referencia || '';

  const elTasa = document.getElementById('modal-input-tasa');
  if (elTasa) elTasa.value = (data.tasa !== null && data.tasa !== undefined) ? data.tasa : '';

  const elBcv = document.getElementById('modal-input-bcv');
  if (elBcv) elBcv.value = (data.bcv_sap !== null && data.bcv_sap !== undefined) ? data.bcv_sap : '';

  const elDiv = document.getElementById('modal-input-division');
  if (elDiv) elDiv.value = data.division || '';

  const elMes = document.getElementById('modal-input-mes');
  if (elMes) elMes.value = (data.mes || 'ENERO').toUpperCase();

  const elAno = document.getElementById('modal-input-ano');
  if (elAno) elAno.value = data.año || (data.fecha ? data.fecha.split('-')[0] : '2026');

  const elBenef = document.getElementById('modal-input-beneficiario');
  if (elBenef) elBenef.value = data.beneficiario || '';

  const elCon = document.getElementById('modal-input-concepto');
  if (elCon) elCon.value = data.concepto || '';

  const elCon1 = document.getElementById('modal-input-concepto1');
  if (elCon1) elCon1.value = data.concepto1 || '';

  const elTxt = document.getElementById('modal-input-texto');
  if (elTxt) elTxt.value = data.texto || '';

  modal.classList.add('open');
};

function closeTransactionModal() {
  const modal = document.getElementById('detail-modal');
  if (modal) modal.classList.remove('open');
  currentEditingItem = null;
  hideModalAlert();
}

// Build URL query parameters from active filters
function buildExportParams(format = 'xlsx') {
  const params = new URLSearchParams();
  params.set('format', format);

  if (state.filters.es) params.set('es', state.filters.es);
  if (state.filters.mes) params.set('mes', state.filters.mes);
  if (state.filters.clasificacion) params.set('clasificacion', state.filters.clasificacion);
  if (state.filters.banco) params.set('banco', state.filters.banco);
  if (state.filters.medio_ejecucion) params.set('medio_ejecucion', state.filters.medio_ejecucion);
  if (state.filters.dateFrom) params.set('date_from', state.filters.dateFrom);
  if (state.filters.dateTo) params.set('date_to', state.filters.dateTo);
  if (state.filters.documento) params.set('documento', state.filters.documento);
  if (state.filters.beneficiario) params.set('beneficiario', state.filters.beneficiario);
  if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) params.set('min_monto', state.filters.minAmount);
  if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) params.set('max_monto', state.filters.maxAmount);
  if (state.filters.search) params.set('search', state.filters.search);

  if (state.sortBy) params.set('sort_by', state.sortBy);
  params.set('sort_dir', state.sortAsc ? 'asc' : 'desc');

  return params;
}

// Generate human-readable dynamic filename: movimientos_[FILTROS_ACTIVOS]_[FECHA].[ext]
function getExportFilename(extension = 'xlsx') {
  const parts = ['movimientos'];

  if (state.filters.es) parts.push(state.filters.es.trim().replace(/[^a-zA-Z0-9]+/g, '_'));
  if (state.filters.mes) parts.push(state.filters.mes.trim().replace(/[^a-zA-Z0-9]+/g, '_'));
  if (state.filters.clasificacion) parts.push(state.filters.clasificacion.trim().replace(/[^a-zA-Z0-9]+/g, '_'));
  if (state.filters.banco) parts.push(state.filters.banco.trim().replace(/[^a-zA-Z0-9]+/g, '_'));
  if (state.filters.medio_ejecucion) parts.push(state.filters.medio_ejecucion.trim().replace(/[^a-zA-Z0-9]+/g, '_'));
  if (state.filters.dateFrom) parts.push(`desde_${state.filters.dateFrom.replace(/-/g, '')}`);
  if (state.filters.dateTo) parts.push(`hasta_${state.filters.dateTo.replace(/-/g, '')}`);
  if (state.filters.documento) parts.push(`doc_${state.filters.documento.trim().replace(/[^a-zA-Z0-9]+/g, '_')}`);
  if (state.filters.beneficiario) parts.push(`benef_${state.filters.beneficiario.trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 15)}`);
  if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) parts.push(`min_${parseInt(state.filters.minAmount)}`);
  if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) parts.push(`max_${parseInt(state.filters.maxAmount)}`);
  if (state.filters.search) parts.push(`busq_${state.filters.search.trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 12)}`);

  if (parts.length === 1) {
    parts.push('todos');
  }

  const today = new Date().toISOString().slice(0, 10);
  parts.push(today);

  let raw = parts.join('_');
  let clean = raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${clean}.${extension}`;
}

// Trigger direct browser download from server without revoking/blob timeout issues
function triggerDirectDownload(url, filename = '') {
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  if (filename) {
    link.setAttribute('download', filename);
  } else {
    link.setAttribute('download', '');
  }
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
  }, 4000);
}

// Descargar Plantilla CSV Oficial (Separada por comas)
function downloadTemplateCSV(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  const headers = [
    'SEMANA', 'es', 'mes', 'año', 'clasificacion', 'fecha', 'banco',
    'documento', 'tipo', 'referencia', 'Monto BS', 'tasa', 'bcv_sap',
    'monto', 'division', 'beneficiario', 'concepto', 'texto',
    'concepto1', 'clas', 'medio_ejecucion'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const sampleRows = [
    [
      '', 'INGRESO', 'ENERO', '2026', 'OPERATIVO', '02/01/2026', 'BANESCO 995',
      '1100188942', 'NC', '34044646', '100,000.00', '301.37', '332.00',
      '331.82', '1208', '34044646', 'ANTICIPO RECIBIDO DE CLIENTES',
      'PAGO CUOTA 1 CLIENTE 34044646', 'ANTICIPO RECIBIDO DE CLIENTES', 'MAC', 'BANCOS NACIONALES'
    ],
    [
      '', 'EGRESO', 'ENERO', '2026', 'OPERATIVO', '05/01/2026', 'BNC 045',
      '1100196666', 'ND', 'REF-98765', '-131,981.20', '355.55', '355.55',
      '-370.87', '1208', 'EXCELLENCE HOTELES', 'HOSPEDAJE PERSONAL',
      'FACTURA 0393 HOSPEDAJE', 'GASTOS DE PERSONAL', 'MPD', 'BANCOS NACIONALES'
    ],
    [
      '', 'INGRESO', 'ENERO', '2026', 'OPERATIVO', '10/01/2026', 'BANCO MERCANTIL',
      '1100201122', 'TR', '34044646', '45,000.00', '301.37', '301.37',
      '149.32', '1208', 'DISTRIBUIDORA ANDINA', 'COBRO FACTURA 5420',
      'COBRO SERVICIOS ENERO', 'VENTAS AL MAYOR', 'MAC', 'BANCOS NACIONALES'
    ],
    [
      '', 'EGRESO', 'ENERO', '2026', 'OPERATIVO', '15/01/2026', 'BANCO PROVINCIAL',
      '1100215544', 'TR', 'REF-11442', '-25,000.00', '301.37', '301.37',
      '-82.95', '1208', 'CANTV SERVICIOS', 'PAGO TELEFONIA E INTERNET',
      'PAGO MENSUAL CANTV', 'SERVICIOS PUBLICOS', 'MPD', 'BANCOS NACIONALES'
    ]
  ];

  const lines = [
    headers.map(escapeCsv).join(','),
    ...sampleRows.map(row => row.map(escapeCsv).join(','))
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  triggerDirectDownload(url, 'Plantilla_Movimientos.csv');
}

// Consultar registros filtrados directamente desde Supabase respetando todos los filtros activos
async function fetchFilteredRecordsForExport(onProgress) {
  if (!supabaseClient) {
    initSupabase();
  }
  if (!supabaseClient) {
    throw new Error('No se pudo inicializar la conexión con Supabase.');
  }

  // Generador de consulta con todos los filtros de estado aplicados
  const buildBaseQuery = (isCountOnly = false) => {
    let query = supabaseClient
      .from('fc_mov')
      .select(
        isCountOnly
          ? 'id'
          : 'id, fecha, es, banco, medio_ejecucion, clasificacion, documento, referencia, tasa, bcv_sap, monto, division, beneficiario, concepto, concepto1, texto, mes, año',
        { count: 'exact', head: isCountOnly }
      );

    if (state.filters.es) query = query.eq('es', state.filters.es);
    if (state.filters.mes) query = query.eq('mes', state.filters.mes);
    if (state.filters.clasificacion) query = query.eq('clasificacion', state.filters.clasificacion);
    if (state.filters.banco) query = query.eq('banco', state.filters.banco);
    if (state.filters.medio_ejecucion) query = query.eq('medio_ejecucion', state.filters.medio_ejecucion);
    if (state.filters.dateFrom) query = query.gte('fecha', state.filters.dateFrom);
    if (state.filters.dateTo) query = query.lte('fecha', state.filters.dateTo);
    if (state.filters.documento) {
      const docTerm = `%${state.filters.documento}%`;
      query = query.or(`documento.ilike.${docTerm},referencia.ilike.${docTerm}`);
    }
    if (state.filters.beneficiario) {
      query = query.ilike('beneficiario', `%${state.filters.beneficiario}%`);
    }
    if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) {
      query = query.gte('monto', state.filters.minAmount);
    }
    if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) {
      query = query.lte('monto', state.filters.maxAmount);
    }
    if (state.filters.search) {
      const term = `%${state.filters.search}%`;
      query = query.or(`beneficiario.ilike.${term},concepto.ilike.${term},documento.ilike.${term},referencia.ilike.${term}`);
    }

    if (!isCountOnly) {
      query = query.order(state.sortBy || 'fecha', { ascending: !!state.sortAsc, nullsFirst: false });
    }
    return query;
  };

  // 1. Obtener conteo total filtrado
  const countRes = await buildBaseQuery(true);
  if (countRes.error) throw countRes.error;
  const totalCount = countRes.count || 0;

  if (totalCount === 0) {
    return [];
  }

  // 2. Descargar en lotes de hasta 1000 registros (límite de Supabase por página)
  const BATCH_SIZE = 1000;
  // Límite de seguridad para exportación completa
  const MAX_RECORDS = 50000;
  const targetCount = Math.min(totalCount, MAX_RECORDS);

  let allRecords = [];
  for (let from = 0; from < targetCount; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, targetCount - 1);
    if (typeof onProgress === 'function') {
      onProgress(allRecords.length, targetCount);
    }
    const chunkQuery = buildBaseQuery(false).range(from, to);
    const { data, error } = await chunkQuery;
    if (error) throw error;
    if (data && data.length > 0) {
      allRecords = allRecords.concat(data);
    } else {
      break;
    }
  }

  if (typeof onProgress === 'function') {
    onProgress(allRecords.length, targetCount);
  }

  return allRecords;
}

// Export Filtered Dataset to native Excel (.xlsx) directamente en el navegador
async function exportToExcel() {
  const btn = document.getElementById('btn-export-excel');
  const originalText = btn ? btn.innerHTML : '📊 Exportar a Excel';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Consultando registros...';
  }

  try {
    const filename = getExportFilename('xlsx');

    // Obtener registros con indicador de progreso en el botón
    const records = await fetchFilteredRecordsForExport((loaded, total) => {
      if (btn) {
        btn.innerHTML = `<div class="spinner"></div> Exportando ${formatNumber(loaded)} / ${formatNumber(total)}...`;
      }
    });

    if (!records || records.length === 0) {
      alert('No se encontraron registros que coincidan con los filtros aplicados.');
      return;
    }

    if (btn) {
      btn.innerHTML = '<div class="spinner"></div> Generando archivo .xlsx...';
    }

    if (typeof window.XLSX === 'undefined') {
      throw new Error('La librería SheetJS (XLSX) no está cargada.');
    }

    const headers = [
      'ID', 'Fecha', 'Tipo Flujo', 'Banco', 'Medio Ejecución', 'Clasificación',
      'Nro Documento', 'Referencia', 'Tasa Cambio', 'BCV SAP', 'Monto USD',
      'División', 'Beneficiario / Cliente', 'Concepto', 'Concepto Secundario',
      'Texto / Observación', 'Mes', 'Año'
    ];

    const dataRows = records.map(r => [
      r.id,
      r.fecha || '',
      r.es || '',
      r.banco || '',
      r.medio_ejecucion || '',
      r.clasificacion || '',
      r.documento || '',
      r.referencia || '',
      (r.tasa !== null && r.tasa !== undefined && r.tasa !== '') ? Number(r.tasa) : '',
      (r.bcv_sap !== null && r.bcv_sap !== undefined && r.bcv_sap !== '') ? Number(r.bcv_sap) : '',
      (r.monto !== null && r.monto !== undefined && r.monto !== '') ? Number(r.monto) : 0,
      r.division || '',
      r.beneficiario || '',
      r.concepto || '',
      r.concepto1 || '',
      r.texto || '',
      r.mes || '',
      r.año || ''
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

    // Ancho de columnas óptimo para visualización ejecutiva
    worksheet['!cols'] = [
      { wch: 9 },   // ID
      { wch: 12 },  // Fecha
      { wch: 12 },  // Tipo Flujo
      { wch: 22 },  // Banco
      { wch: 22 },  // Medio Ejecución
      { wch: 20 },  // Clasificación
      { wch: 16 },  // Nro Documento
      { wch: 16 },  // Referencia
      { wch: 12 },  // Tasa Cambio
      { wch: 12 },  // BCV SAP
      { wch: 15 },  // Monto USD
      { wch: 10 },  // División
      { wch: 28 },  // Beneficiario
      { wch: 28 },  // Concepto
      { wch: 28 },  // Concepto Secundario
      { wch: 32 },  // Texto
      { wch: 12 },  // Mes
      { wch: 8 }    // Año
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Flujo de Caja');

    // Descarga directa del archivo nativo Excel
    XLSX.writeFile(workbook, filename);

    if (btn) {
      btn.innerHTML = `✅ ¡${formatNumber(records.length)} Exportados!`;
    }
  } catch (err) {
    console.error('Error al exportar a Excel:', err);
    alert('Error al generar archivo Excel: ' + (err.message || err));
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }, 2500);
  }
}

// Export Filtered View to CSV (separado por comas y con BOM UTF-8) directamente en el navegador
async function exportFilteredCSV() {
  const btn = document.getElementById('btn-export');
  const originalText = btn ? btn.innerHTML : '⬇ Exportar Vista (CSV)';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Consultando registros...';
  }

  try {
    const filename = getExportFilename('csv');

    const records = await fetchFilteredRecordsForExport((loaded, total) => {
      if (btn) {
        btn.innerHTML = `<div class="spinner"></div> Exportando ${formatNumber(loaded)} / ${formatNumber(total)}...`;
      }
    });

    if (!records || records.length === 0) {
      alert('No se encontraron registros que coincidan con los filtros aplicados.');
      return;
    }

    if (btn) {
      btn.innerHTML = '<div class="spinner"></div> Generando CSV...';
    }

    const headers = [
      'ID', 'Fecha', 'Tipo Flujo', 'Banco', 'Medio Ejecución', 'Clasificación',
      'Nro Documento', 'Referencia', 'Tasa Cambio', 'BCV SAP', 'Monto USD',
      'División', 'Beneficiario / Cliente', 'Concepto', 'Concepto Secundario',
      'Texto / Observación', 'Mes', 'Año'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const lines = [
      headers.map(escapeCsv).join(','),
      ...records.map(r => [
        r.id,
        r.fecha || '',
        r.es || '',
        r.banco || '',
        r.medio_ejecucion || '',
        r.clasificacion || '',
        r.documento || '',
        r.referencia || '',
        (r.tasa !== null && r.tasa !== undefined) ? r.tasa : '',
        (r.bcv_sap !== null && r.bcv_sap !== undefined) ? r.bcv_sap : '',
        (r.monto !== null && r.monto !== undefined) ? r.monto : '0.00',
        r.division || '',
        r.beneficiario || '',
        r.concepto || '',
        r.concepto1 || '',
        r.texto || '',
        r.mes || '',
        r.año || ''
      ].map(escapeCsv).join(','))
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    triggerDirectDownload(url, filename);

    if (btn) {
      btn.innerHTML = `✅ ¡${formatNumber(records.length)} Exportados!`;
    }
  } catch (err) {
    console.error('Error exportando CSV:', err);
    alert('Error al exportar CSV: ' + (err.message || err));
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }, 2500);
  }
}

// Helpers
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Update Active Filters Counter Badge
function updateActiveFiltersBadge() {
  const badge = document.getElementById('filter-active-count');
  if (!badge) return;

  let activeCount = 0;
  if (state.filters.search) activeCount++;
  if (state.filters.es) activeCount++;
  if (state.filters.mes) activeCount++;
  if (state.filters.clasificacion) activeCount++;
  if (state.filters.banco) activeCount++;
  if (state.filters.medio_ejecucion) activeCount++;
  if (state.filters.dateFrom) activeCount++;
  if (state.filters.dateTo) activeCount++;
  if (state.filters.documento) activeCount++;
  if (state.filters.beneficiario) activeCount++;
  if (state.filters.minAmount !== null && !isNaN(state.filters.minAmount)) activeCount++;
  if (state.filters.maxAmount !== null && !isNaN(state.filters.maxAmount)) activeCount++;

  if (activeCount === 0) {
    badge.textContent = 'Todos los registros';
    badge.classList.remove('has-active');
  } else {
    badge.textContent = `${activeCount} filtro${activeCount > 1 ? 's' : ''} activo${activeCount > 1 ? 's' : ''}`;
    badge.classList.add('has-active');
  }
}

// Setup Event Listeners
function setupEvents() {
  // Search input debounce
  let debounceTimer;
  const searchInput = document.getElementById('filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        state.page = 1;
        updateActiveFiltersBadge();
        fetchTableData();
        updateAnalytics();
      }, 350);
    });
  }

  // Filter Selects
  const bindSelect = (id, filterKey) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        state.filters[filterKey] = e.target.value;
        state.page = 1;
        updateActiveFiltersBadge();
        fetchTableData();
        updateAnalytics();
      });
    }
  };

  bindSelect('filter-es', 'es');
  bindSelect('filter-mes', 'mes');
  bindSelect('filter-clas', 'clasificacion');
  bindSelect('filter-banco', 'banco');
  bindSelect('filter-medio', 'medio_ejecucion');

  // Reset Filters
  const resetBtn = document.getElementById('btn-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.filters = {
        search: '',
        es: '',
        mes: '',
        clasificacion: '',
        banco: '',
        medio_ejecucion: '',
        dateFrom: '',
        dateTo: '',
        documento: '',
        beneficiario: '',
        minAmount: null,
        maxAmount: null
      };
      state.page = 1;
      if (searchInput) searchInput.value = '';
      [
        'filter-es', 'filter-mes', 'filter-clas', 'filter-banco', 'filter-medio',
        'table-filter-date-from', 'table-filter-date-to', 'table-filter-doc',
        'table-filter-benef', 'table-filter-min-monto', 'table-filter-max-monto'
      ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      updateActiveFiltersBadge();
      fetchTableData();
      updateAnalytics();
    });
  }

  // Page Size Selector
  const pageSizeSelect = document.getElementById('page-size-select');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.page = 1;
      fetchTableData();
    });
  }

  // Refresh Button
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<div class="spinner"></div> Actualizando...';
      await checkSupabaseConnection();
      await fetchTableData();
      await updateAnalytics();
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '🔄 Actualizar';
    });
  }

  // Export CSV Button
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportFilteredCSV);
  }

  // Export Excel Button
  const exportExcelBtn = document.getElementById('btn-export-excel');
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', exportToExcel);
  }

  // Template CSV Download Buttons (Client-side directly in CSV)
  const downloadTemplateBtn = document.getElementById('btn-download-template');
  if (downloadTemplateBtn) {
    downloadTemplateBtn.addEventListener('click', downloadTemplateCSV);
  }
  const downloadTemplateModalBtn = document.getElementById('btn-download-template-modal');
  if (downloadTemplateModalBtn) {
    downloadTemplateModalBtn.addEventListener('click', downloadTemplateCSV);
  }

  // Unified Filter Block Toggle (Expand/Collapse - Expanded by default)
  const toggleFilterBtn = document.getElementById('btn-toggle-filter-block');
  const filterBlockBody = document.getElementById('filter-block-body');
  if (toggleFilterBtn && filterBlockBody) {
    toggleFilterBtn.addEventListener('click', () => {
      const isCollapsed = filterBlockBody.classList.toggle('collapsed');
      toggleFilterBtn.innerHTML = isCollapsed ? '▼ Mostrar Filtros' : '▲ Ocultar Filtros';
      toggleFilterBtn.setAttribute('aria-expanded', !isCollapsed);
    });
  }

  // Shortcut from Table Toolbar to Unified Filter Panel
  const toggleTableFiltersBtn = document.getElementById('btn-toggle-table-filters');
  if (toggleTableFiltersBtn) {
    toggleTableFiltersBtn.addEventListener('click', () => {
      if (filterBlockBody && filterBlockBody.classList.contains('collapsed')) {
        filterBlockBody.classList.remove('collapsed');
        if (toggleFilterBtn) toggleFilterBtn.innerHTML = '▲ Ocultar Filtros';
      }
      const filterSection = document.getElementById('filter-section');
      if (filterSection) {
        filterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Table-specific Filter Inputs
  setupTableFiltersEvents();

  // Sortable Table Headers
  setupSortingEvents();

  // Modal Close Events
  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) modalClose.addEventListener('click', closeTransactionModal);

  const modalOverlay = document.getElementById('detail-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeTransactionModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTransactionModal();
  });

  // Setup CRUD events for Modal
  setupModalCrudEvents();

  // Setup CSV Upload and Verification Events
  setupCsvUploadEvents();
}

function setupModalCrudEvents() {
  // Update Flow badge when Tipo select changes
  const esSelect = document.getElementById('modal-input-es');
  if (esSelect) {
    esSelect.addEventListener('change', (e) => {
      const isIngreso = e.target.value === 'INGRESO';
      const flowBadge = document.getElementById('modal-flow-badge');
      if (flowBadge) {
        flowBadge.innerHTML = isIngreso
          ? '<span class="badge-flow ingreso">↑ Ingreso</span>'
          : '<span class="badge-flow egreso">↓ Egreso</span>';
      }
    });
  }

  // Cancel Button
  const cancelBtn = document.getElementById('modal-btn-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeTransactionModal);
  }

  // CRUD Form Submit (UPDATE)
  const crudForm = document.getElementById('modal-crud-form');
  if (crudForm) {
    crudForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('modal-btn-save');
      const saveText = document.getElementById('modal-save-text');
      const saveSpinner = document.getElementById('modal-save-spinner');

      const id = parseInt(document.getElementById('modal-input-id')?.value);
      if (!id) {
        showModalAlert('error', 'ID de movimiento no válido.');
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      if (saveSpinner) saveSpinner.style.display = 'inline-block';
      if (saveText) saveText.textContent = 'Guardando...';
      hideModalAlert();

      try {
        const auth = getStoredAuth();
        const userId = auth && auth.user ? auth.user.id : 2;

        const payload = {
          action: 'update',
          usuario_id: userId,
          id: id,
          fecha: document.getElementById('modal-input-fecha')?.value || '',
          es: document.getElementById('modal-input-es')?.value || 'INGRESO',
          monto: parseFloat(document.getElementById('modal-input-monto')?.value) || 0,
          medio_ejecucion: (document.getElementById('modal-input-medio')?.value || '').trim(),
          clasificacion: (document.getElementById('modal-input-clas')?.value || '').trim(),
          referencia: (document.getElementById('modal-input-referencia')?.value || '').trim(),
          tasa: document.getElementById('modal-input-tasa')?.value !== '' ? parseFloat(document.getElementById('modal-input-tasa').value) : null,
          bcv_sap: document.getElementById('modal-input-bcv')?.value !== '' ? parseFloat(document.getElementById('modal-input-bcv').value) : null,
          division: (document.getElementById('modal-input-division')?.value || '').trim(),
          mes: document.getElementById('modal-input-mes')?.value || '',
          año: (document.getElementById('modal-input-ano')?.value || '').trim(),
          beneficiario: (document.getElementById('modal-input-beneficiario')?.value || '').trim(),
          concepto: (document.getElementById('modal-input-concepto')?.value || '').trim(),
          concepto1: (document.getElementById('modal-input-concepto1')?.value || '').trim(),
          texto: (document.getElementById('modal-input-texto')?.value || '').trim()
        };

        let res = null;
        try {
          const resp = await fetch('crud_movimiento.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (resp.ok) {
            res = await resp.json();
          }
        } catch (phpErr) {
          console.warn('crud_movimiento.php no disponible (modo Vercel). Actualizando directamente en Supabase...', phpErr);
        }

        // Respaldo directo en Supabase (para despliegue en Vercel)
        if (!res || !res.success) {
          if (supabaseClient) {
            const updateData = {
              fecha: payload.fecha,
              es: payload.es,
              monto: payload.monto,
              medio_ejecucion: payload.medio_ejecucion,
              clasificacion: payload.clasificacion,
              referencia: payload.referencia,
              tasa: payload.tasa,
              bcv_sap: payload.bcv_sap,
              division: payload.division,
              mes: payload.mes,
              año: payload.año,
              beneficiario: payload.beneficiario,
              concepto: payload.concepto,
              concepto1: payload.concepto1,
              texto: payload.texto
            };
            const { error: supUpdateErr } = await supabaseClient
              .from('fc_mov')
              .update(updateData)
              .eq('id', id);

            if (!supUpdateErr) {
              res = { success: true };
              try {
                await supabaseClient.from('control_cambios').insert({
                  tabla_afectada: 'fc_mov',
                  registro_id: id,
                  operacion: 'UPDATE',
                  usuario_id: userId,
                  detalles_json: JSON.stringify(updateData),
                  created_at: new Date().toISOString()
                });
              } catch (_) {}
            } else {
              res = { success: false, error: supUpdateErr.message };
            }
          }
        }

        if (res && res.success) {
          showModalAlert('success', `Movimiento #${id} actualizado correctamente. Registrado en control_cambios.`);
          
          // Refresh table data and analytics in real time
          await fetchTableData();
          await updateAnalytics();

          setTimeout(() => {
            closeTransactionModal();
          }, 1200);
        } else {
          showModalAlert('error', (res && res.error) || 'Error al actualizar el movimiento.');
        }
      } catch (err) {
        console.error('Error al guardar movimiento:', err);
        showModalAlert('error', 'Error de conexión con el servidor: ' + (err.message || err));
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (saveSpinner) saveSpinner.style.display = 'none';
        if (saveText) saveText.textContent = '💾 Guardar Cambios';
      }
    });
  }

  // Delete Button (DELETE)
  const deleteBtn = document.getElementById('modal-btn-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const id = parseInt(document.getElementById('modal-input-id')?.value);
      if (!id) return;

      const confirmed = confirm(
        `¿Está seguro de que desea eliminar permanentemente el movimiento #${id}?\n\nEsta operación se registrará en la tabla control_cambios de la base de datos.`
      );
      if (!confirmed) return;

      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '<div class="spinner"></div> Eliminando...';
      hideModalAlert();

      try {
        const auth = getStoredAuth();
        const userId = auth && auth.user ? auth.user.id : 2;

        let res = null;
        try {
          const resp = await fetch('crud_movimiento.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'delete',
              usuario_id: userId,
              id: id
            })
          });
          if (resp.ok) {
            res = await resp.json();
          }
        } catch (phpErr) {
          console.warn('crud_movimiento.php no disponible (modo Vercel). Eliminando directamente en Supabase...', phpErr);
        }

        // Respaldo directo en Supabase (para despliegue en Vercel)
        if (!res || !res.success) {
          if (supabaseClient) {
            const { error: supDelErr } = await supabaseClient
              .from('fc_mov')
              .delete()
              .eq('id', id);

            if (!supDelErr) {
              res = { success: true };
              try {
                await supabaseClient.from('control_cambios').insert({
                  tabla_afectada: 'fc_mov',
                  registro_id: id,
                  operacion: 'DELETE',
                  usuario_id: userId,
                  detalles_json: JSON.stringify({ id: id }),
                  created_at: new Date().toISOString()
                });
              } catch (_) {}
            } else {
              res = { success: false, error: supDelErr.message };
            }
          }
        }

        if (res && res.success) {
          showModalAlert('success', `Movimiento #${id} eliminado correctamente.`);

          // Refresh table data and analytics
          await fetchTableData();
          await updateAnalytics();

          setTimeout(() => {
            closeTransactionModal();
          }, 1200);
        } else {
          showModalAlert('error', (res && res.error) || 'Error al eliminar el movimiento.');
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = '🗑️ Eliminar Movimiento';
        }
      } catch (err) {
        console.error('Error al eliminar movimiento:', err);
        showModalAlert('error', 'Error al procesar eliminación: ' + (err.message || err));
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '🗑️ Eliminar Movimiento';
      }
    });
  }
}

function setupTableFiltersEvents() {
  let timer;
  const onTableFilterChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.dateFrom = (document.getElementById('table-filter-date-from')?.value || '').trim();
      state.filters.dateTo = (document.getElementById('table-filter-date-to')?.value || '').trim();
      state.filters.documento = (document.getElementById('table-filter-doc')?.value || '').trim();
      state.filters.beneficiario = (document.getElementById('table-filter-benef')?.value || '').trim();
      
      const minVal = document.getElementById('table-filter-min-monto')?.value;
      state.filters.minAmount = (minVal !== '' && !isNaN(minVal)) ? parseFloat(minVal) : null;

      const maxVal = document.getElementById('table-filter-max-monto')?.value;
      state.filters.maxAmount = (maxVal !== '' && !isNaN(maxVal)) ? parseFloat(maxVal) : null;

      state.page = 1;
      updateActiveFiltersBadge();
      fetchTableData();
      updateAnalytics();
    }, 350);
  };

  ['table-filter-date-from', 'table-filter-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', onTableFilterChange);
  });

  ['table-filter-doc', 'table-filter-benef', 'table-filter-min-monto', 'table-filter-max-monto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', onTableFilterChange);
  });

  // Clear Table Filters
  const clearTableBtn = document.getElementById('btn-clear-table-filters');
  if (clearTableBtn) {
    clearTableBtn.addEventListener('click', () => {
      ['table-filter-date-from', 'table-filter-date-to', 'table-filter-doc', 'table-filter-benef', 'table-filter-min-monto', 'table-filter-max-monto'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      state.filters.dateFrom = '';
      state.filters.dateTo = '';
      state.filters.documento = '';
      state.filters.beneficiario = '';
      state.filters.minAmount = null;
      state.filters.maxAmount = null;
      state.page = 1;
      updateActiveFiltersBadge();
      fetchTableData();
      updateAnalytics();
    });
  }
}

function setupSortingEvents() {
  const headers = document.querySelectorAll('.data-table th.sortable');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      if (!field) return;

      if (state.sortBy === field) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortBy = field;
        // Default descending for date and amount, ascending for text
        state.sortAsc = (field === 'fecha' || field === 'monto') ? false : true;
      }

      // Update all header icons
      headers.forEach(h => {
        h.classList.remove('active');
        const icon = h.querySelector('.sort-icon');
        if (icon) icon.textContent = '⇅';
      });

      th.classList.add('active');
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = state.sortAsc ? '▲' : '▼';

      state.page = 1;
      fetchTableData();
    });
  });
}

/* ==========================================================================
   Authentication & Login Flow Controller
   ========================================================================== */
let currentUser = null;

function getStoredAuth() {
  const local = localStorage.getItem('flujocaja_auth');
  if (local) {
    try { return JSON.parse(local); } catch(e){}
  }
  const session = sessionStorage.getItem('flujocaja_auth');
  if (session) {
    try { return JSON.parse(session); } catch(e){}
  }
  return null;
}

function updateAuthUI(user) {
  const dashboard = document.getElementById('dashboard-container');
  const loginOverlay = document.getElementById('login-overlay');
  const userBadge = document.getElementById('user-profile-badge');
  const userNameEl = document.getElementById('user-name');
  const userAvatar = document.getElementById('user-avatar');

  if (user) {
    currentUser = user;
    if (dashboard) dashboard.classList.remove('blurred');
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (userBadge) userBadge.style.display = 'flex';
    if (userNameEl) userNameEl.textContent = user.nombre || 'vcappugi';
    if (userAvatar) {
      const initials = (user.nombre || 'VC').slice(0, 2).toUpperCase();
      userAvatar.textContent = initials;
    }
  } else {
    currentUser = null;
    if (dashboard) dashboard.classList.add('blurred');
    if (loginOverlay) {
      loginOverlay.classList.remove('hidden');
      const passInput = document.getElementById('login-password');
      if (passInput) passInput.value = '';
    }
    if (userBadge) userBadge.style.display = 'none';
  }
}

// ==============================================================================
// CSV Upload & Verification Modal Controller
// ==============================================================================
let verifiedCsvData = null;
let currentCsvTab = 'all';

function setupCsvUploadEvents() {
  const btnOpenUpload = document.getElementById('btn-open-upload');
  const fileInput = document.getElementById('csv-file-input');
  const modalOverlay = document.getElementById('csv-modal-overlay');
  const modalClose = document.getElementById('csv-modal-close');
  const btnCancel = document.getElementById('csv-modal-btn-cancel');
  const btnChooseOther = document.getElementById('csv-btn-choose-other');
  const btnCommit = document.getElementById('csv-modal-btn-commit');
  const dropzone = document.getElementById('csv-dropzone');
  const btnBrowse = document.getElementById('btn-browse-file');
  const resultsArea = document.getElementById('csv-results-area');

  // Open CSV Modal
  if (btnOpenUpload) {
    btnOpenUpload.addEventListener('click', () => {
      if (modalOverlay) modalOverlay.classList.add('open');
      if (!verifiedCsvData) {
        if (dropzone) dropzone.style.display = 'flex';
        if (resultsArea) resultsArea.style.display = 'none';
        const footerNote = document.getElementById('csv-footer-note');
        if (footerNote) footerNote.innerHTML = '<span>Seleccione o arrastre un archivo CSV para verificar.</span>';
        if (btnCommit) btnCommit.disabled = true;
        const commitText = document.getElementById('csv-commit-text');
        if (commitText) commitText.textContent = 'Seleccione un archivo';
      }
    });
  }

  // Hidden File input change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleCsvFileVerification(file);
      }
    });
  }

  // Dropzone drag-and-drop
  if (dropzone && fileInput) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleCsvFileVerification(e.dataTransfer.files[0]);
      }
    });

    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      fileInput.value = '';
      fileInput.click();
    });
  }

  // Browse file button inside dropzone
  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.value = '';
      fileInput.click();
    });
  }

  // Load sample file button inside dropzone
  const btnLoadSample = document.getElementById('btn-load-sample');
  if (btnLoadSample) {
    btnLoadSample.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const resp = await fetch('test_carga_movimientos.csv');
        const text = await resp.text();
        const file = new File([text], 'test_carga_movimientos.csv', { type: 'text/csv' });
        handleCsvFileVerification(file);
      } catch (err) {
        console.error('Error al cargar archivo de prueba:', err);
        alert('No se pudo cargar el archivo de prueba.');
      }
    });
  }

  // Choose other file button
  if (btnChooseOther && fileInput) {
    btnChooseOther.addEventListener('click', () => {
      verifiedCsvData = null;
      if (dropzone) dropzone.style.display = 'flex';
      if (resultsArea) resultsArea.style.display = 'none';
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (modalClose) modalClose.addEventListener('click', closeCsvModal);
  if (btnCancel) btnCancel.addEventListener('click', closeCsvModal);

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeCsvModal();
    });
  }

  // Filter tabs inside the verification modal
  ['all', 'valid', 'rejected'].forEach(tab => {
    const tabBtn = document.getElementById(`csv-tab-${tab}`);
    if (tabBtn) {
      tabBtn.addEventListener('click', () => {
        document.querySelectorAll('.csv-tab').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        currentCsvTab = tab;
        renderCsvVerificationRows();
      });
    }
  });

  // Commit valid records button
  if (btnCommit) {
    btnCommit.addEventListener('click', commitValidCsvRecords);
  }
}

function closeCsvModal() {
  const modalOverlay = document.getElementById('csv-modal-overlay');
  if (modalOverlay) {
    modalOverlay.classList.remove('open');
  }
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';
}

// Helper: Parse Date in CSV formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD)
function parseCsvDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  const ymdMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

// Helper: Parse Number handling European (1.234,56) and US (1,234.56) formats
function parseCsvNumber(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (s === '') return null;

  let isNeg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNeg = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    isNeg = true;
    s = s.slice(1).trim();
  }

  s = s.replace(/[\$\€\Bs\s]/gi, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    s = s.replace(',', '.');
  }

  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return isNeg ? -Math.abs(num) : num;
}

// Helper: Split CSV line handling quoted strings and delimiters
function splitCsvLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Client-side CSV Parser & Validator compatible with Vercel and offline hosting
function parseAndValidateCsvClient(csvText, filename = 'archivo.csv') {
  const CSV_MONTH_NAMES = {
    1: 'ENERO', 2: 'FEBRERO', 3: 'MARZO', 4: 'ABRIL',
    5: 'MAYO', 6: 'JUNIO', 7: 'JULIO', 8: 'AGOSTO',
    9: 'SEPTIEMBRE', 10: 'OCTUBRE', 11: 'NOVIEMBRE', 12: 'DICIEMBRE'
  };

  let text = csvText.replace(/^\uFEFF/, '').trim();
  if (!text) {
    throw new Error('El archivo CSV está vacío.');
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('El archivo CSV no contiene registros de datos (solo encabezados o vacío).');
  }

  // Detect delimiter: semicolon or comma
  const firstLine = lines[0];
  const countSemicolon = (firstLine.match(/;/g) || []).length;
  const countComma = (firstLine.match(/,/g) || []).length;
  const delimiter = countSemicolon >= countComma ? ';' : ',';

  const rawHeaders = splitCsvLine(firstLine, delimiter).map(h => h.trim());
  const cleanHeaders = rawHeaders.map(h => {
    return h.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  });

  const findCol = (terms) => {
    for (let term of terms) {
      const idx = cleanHeaders.findIndex(h => h === term || h.includes(term));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colMap = {
    semana: findCol(['semana']),
    es: findCol(['es', 'flujo', 'tipoflujo']),
    mes: findCol(['mes']),
    ano: findCol(['ano', 'anho', 'periodo', 'year']),
    clasificacion: findCol(['clasificacion', 'categoria']),
    fecha: findCol(['fecha', 'date']),
    banco: findCol(['banco', 'entidad']),
    documento: findCol(['documento', 'doc', 'ndocumento']),
    tipo: findCol(['tipo']),
    referencia: findCol(['referencia', 'ref']),
    monto_bs: findCol(['montobs', 'bs', 'bolivares']),
    tasa: findCol(['tasa', 'tasadecambio']),
    bcv_sap: findCol(['bcvsap', 'bcv']),
    monto: findCol(['monto', 'monto_usd', 'usd', 'importe']),
    division: findCol(['division']),
    beneficiario: findCol(['beneficiario', 'cliente', 'proveedor']),
    concepto: findCol(['concepto']),
    texto: findCol(['texto', 'observacion']),
    concepto1: findCol(['concepto1']),
    clas: findCol(['clas']),
    medio_ejecucion: findCol(['medioejecucion', 'medio'])
  };

  if (colMap.es === -1 || colMap.fecha === -1 || colMap.monto === -1) {
    throw new Error("El archivo CSV no contiene las columnas mínimas requeridas ('es', 'fecha', 'monto').");
  }

  const results = [];
  let validCount = 0;
  let rejectedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawCols = splitCsvLine(lines[i], delimiter);
    const rowNum = i + 1;
    const reasons = [];

    const getVal = (key) => {
      const idx = colMap[key];
      return (idx !== -1 && idx < rawCols.length) ? rawCols[idx].trim() : '';
    };

    const raw_es = getVal('es').toUpperCase();
    const raw_fecha = getVal('fecha');
    const raw_banco = getVal('banco');
    const raw_documento = getVal('documento');
    const raw_referencia = getVal('referencia');
    const raw_monto = getVal('monto');
    const raw_tasa = getVal('tasa');
    const raw_bcv_sap = getVal('bcv_sap');
    const raw_clasificacion = getVal('clasificacion');
    const raw_medio = getVal('medio_ejecucion');
    const raw_beneficiario = getVal('beneficiario');
    const raw_concepto = getVal('concepto');
    const raw_concepto1 = getVal('concepto1');
    const raw_texto = getVal('texto');
    const raw_tipo = getVal('tipo');
    const raw_division = getVal('division');
    let raw_mes = getVal('mes').toUpperCase();
    let raw_ano = getVal('ano');
    const raw_semana = getVal('semana');
    const raw_clas = getVal('clas');

    // Validación 1: Flujo ('es')
    let clean_es = null;
    if (raw_es !== 'INGRESO' && raw_es !== 'EGRESO') {
      reasons.push(`Columna 'es' inválida ('${raw_es || 'VACÍO'}'). Debe ser INGRESO o EGRESO.`);
    } else {
      clean_es = raw_es;
    }

    // Validación 2: Fecha
    const clean_fecha = parseCsvDate(raw_fecha);
    if (!clean_fecha) {
      reasons.push(`Fecha inválida ('${raw_fecha || 'VACÍO'}'). Formato requerido: DD/MM/AAAA o AAAA-MM-DD.`);
    }

    // Validación 3: Banco
    const clean_banco = raw_banco;
    if (!clean_banco) {
      reasons.push(`Banco obligatorio. La columna 'banco' no puede estar vacía.`);
    }

    // Validación 4: Documento o Referencia
    const clean_doc = raw_documento || raw_referencia;
    if (!clean_doc) {
      reasons.push(`Documento o referencia obligatorio.`);
    }

    // Validación 5: Monto
    let clean_monto = parseCsvNumber(raw_monto);
    if (clean_monto === null || clean_monto === 0) {
      reasons.push(`Monto inválido o cero ('${raw_monto || 'VACÍO'}').`);
    } else {
      if (clean_es === 'EGRESO' && clean_monto > 0) {
        clean_monto = -clean_monto;
      } else if (clean_es === 'INGRESO' && clean_monto < 0) {
        clean_monto = Math.abs(clean_monto);
      }
    }

    // Mes y Año derivados
    if (clean_fecha) {
      const parts = clean_fecha.split('-');
      if (!raw_mes) {
        const mNum = parseInt(parts[1], 10);
        raw_mes = CSV_MONTH_NAMES[mNum] || 'GENERAL';
      }
      if (!raw_ano) {
        raw_ano = parts[0];
      }
    }

    const isValid = reasons.length === 0;
    if (isValid) {
      validCount++;
    } else {
      rejectedCount++;
    }

    const cleanData = {
      es: clean_es || raw_es,
      mes: raw_mes || 'GENERAL',
      año: raw_ano || String(new Date().getFullYear()),
      clasificacion: raw_clasificacion || 'OPERATIVO',
      fecha: clean_fecha || raw_fecha,
      banco: clean_banco,
      documento: clean_doc,
      tipo: raw_tipo || (clean_es === 'INGRESO' ? 'NC' : 'ND'),
      referencia: raw_referencia || clean_doc,
      tasa: parseCsvNumber(raw_tasa),
      bcv_sap: parseCsvNumber(raw_bcv_sap),
      monto: clean_monto,
      division: raw_division || '',
      beneficiario: raw_beneficiario || '',
      concepto: raw_concepto || '',
      texto: raw_texto || '',
      concepto1: raw_concepto1 || '',
      clas: raw_clas || '',
      medio_ejecucion: raw_medio || ''
    };

    results.push({
      row_number: rowNum,
      status: isValid ? 'valid' : 'rejected',
      reasons: reasons,
      data: cleanData,
      raw: {
        es: raw_es,
        fecha: raw_fecha,
        banco: raw_banco,
        documento: raw_documento,
        referencia: raw_referencia,
        monto: raw_monto
      }
    });
  }

  return {
    success: true,
    filename: filename,
    total: lines.length - 1,
    valid_count: validCount,
    rejected_count: rejectedCount,
    rows: results
  };
}

async function handleCsvFileVerification(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    alert('Por favor seleccione un archivo con formato .CSV válido.');
    return;
  }

  const modalOverlay = document.getElementById('csv-modal-overlay');
  const dropzone = document.getElementById('csv-dropzone');
  const resultsArea = document.getElementById('csv-results-area');
  const filenameEl = document.getElementById('csv-stat-filename');
  const totalEl = document.getElementById('csv-stat-total');
  const validEl = document.getElementById('csv-stat-valid');
  const rejectedEl = document.getElementById('csv-stat-rejected');
  const tableBody = document.getElementById('csv-table-body');
  const footerNote = document.getElementById('csv-footer-note');
  const btnCommit = document.getElementById('csv-modal-btn-commit');
  const commitText = document.getElementById('csv-commit-text');

  // Open modal and switch to results view
  if (modalOverlay) modalOverlay.classList.add('open');
  if (dropzone) dropzone.style.display = 'none';
  if (resultsArea) resultsArea.style.display = 'flex';

  if (filenameEl) {
    filenameEl.textContent = file.name;
    filenameEl.title = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
  if (totalEl) totalEl.textContent = '...';
  if (validEl) validEl.textContent = '...';
  if (rejectedEl) rejectedEl.textContent = '...';
  if (btnCommit) btnCommit.disabled = true;
  if (commitText) commitText.textContent = 'Verificando archivo...';
  if (footerNote) footerNote.innerHTML = '<span>⏳ Analizando y validando estructura de registros...</span>';

  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 36px 20px;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-dim);">
            <div class="spinner" style="width: 24px; height: 24px; border-width: 3px;"></div>
            <span>Validando registros contra el formato oficial...</span>
          </div>
        </td>
      </tr>
    `;
  }

  try {
    let data = null;

    // 1. Intentar primero con backend PHP si está disponible (entorno local XAMPP)
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'validate');

      const resp = await fetch('import_csv.php?action=validate', {
        method: 'POST',
        body: formData
      });

      if (resp.ok) {
        const text = await resp.text();
        if (text && text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.success) {
            data = parsed;
          }
        }
      }
    } catch (phpErr) {
      console.warn('import_csv.php no disponible (modo Vercel). Validando en cliente...', phpErr);
    }

    // 2. Si no respondió PHP (ej. Vercel estático), validar directamente en el navegador
    if (!data) {
      const fileText = await file.text();
      data = parseAndValidateCsvClient(fileText, file.name);
    }

    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Error al validar el archivo CSV.');
    }

    verifiedCsvData = data;
    currentCsvTab = 'all';

    // Reset tabs
    document.querySelectorAll('.csv-tab').forEach(b => b.classList.remove('active'));
    const tabAll = document.getElementById('csv-tab-all');
    if (tabAll) tabAll.classList.add('active');

    // Update stats counters
    if (totalEl) totalEl.textContent = data.total;
    if (validEl) validEl.textContent = data.valid_count;
    if (rejectedEl) rejectedEl.textContent = data.rejected_count;

    document.getElementById('csv-tab-count-all').textContent = data.total;
    document.getElementById('csv-tab-count-valid').textContent = data.valid_count;
    document.getElementById('csv-tab-count-rejected').textContent = data.rejected_count;

    if (data.valid_count > 0) {
      if (btnCommit) btnCommit.disabled = false;
      if (commitText) commitText.textContent = `🚀 Cargar ${data.valid_count} Registros Válidos`;
      if (footerNote) {
        footerNote.innerHTML = `<span>Listo para cargar <strong>${data.valid_count}</strong> registro(s) válido(s) a la tabla. ${data.rejected_count > 0 ? `(<span style="color:#fb7185;">${data.rejected_count} rechazados serán ignorados</span>)` : ''}</span>`;
      }
    } else {
      if (btnCommit) btnCommit.disabled = true;
      if (commitText) commitText.textContent = 'Sin registros válidos';
      if (footerNote) {
        footerNote.innerHTML = '<span style="color: #fb7185;">⚠️ No se encontraron registros válidos para importar. Corrija los errores y vuelva a intentar.</span>';
      }
    }

    renderCsvVerificationRows();

  } catch (err) {
    console.error('Error al procesar CSV:', err);
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 30px; color: #fb7185;">
            <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
            <div style="font-weight: 700; margin-bottom: 4px;">Error en verificación</div>
            <div style="font-size: 13px;">${escapeHTML(err.message || err)}</div>
          </td>
        </tr>
      `;
    }
    if (footerNote) {
      footerNote.innerHTML = `<span style="color: #fb7185;">Error: ${escapeHTML(err.message || err)}</span>`;
    }
    if (btnCommit) btnCommit.disabled = true;
    if (commitText) commitText.textContent = 'Error de archivo';
  }
}

function renderCsvVerificationRows() {
  const tableBody = document.getElementById('csv-table-body');
  if (!tableBody || !verifiedCsvData || !verifiedCsvData.rows) return;

  const rows = verifiedCsvData.rows.filter(r => {
    if (currentCsvTab === 'valid') return r.status === 'valid';
    if (currentCsvTab === 'rejected') return r.status === 'rejected';
    return true;
  });

  if (rows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 36px 20px; color: var(--text-dim);">
          No hay registros en la pestaña seleccionada (${currentCsvTab === 'valid' ? 'Válidos' : (currentCsvTab === 'rejected' ? 'Rechazados' : 'Todos')}).
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = rows.map(r => {
    const isValid = r.status === 'valid';
    const statusBadge = isValid
      ? '<span class="badge-valid">✅ Válido</span>'
      : '<span class="badge-rejected">❌ Rechazado</span>';

    const es = r.data.es || r.raw.es || '-';
    const isIngreso = es === 'INGRESO';
    const flowBadge = `<span class="badge-flow ${isIngreso ? 'ingreso' : 'egreso'}" style="font-size: 11px; padding: 2px 7px;">${escapeHTML(es)}</span>`;

    const fecha = r.data.fecha || r.raw.fecha || '';
    const fechaHtml = fecha ? escapeHTML(fecha) : '<em style="color:#fb7185;">(Vacía)</em>';
    const banco = r.data.banco || '';
    const bancoHtml = banco ? escapeHTML(banco) : '<em style="color:#fb7185;">(Vacío)</em>';
    const doc = r.data.documento || '';
    const docHtml = doc ? escapeHTML(doc) : '<em style="color:#fb7185;">(Vacío)</em>';

    // Amount formatting
    let amountHtml = '-';
    if (r.data.monto !== null && !isNaN(r.data.monto)) {
      const val = parseFloat(r.data.monto);
      const sign = val >= 0 ? '+' : '';
      const colorClass = val >= 0 ? 'color: #34d399;' : 'color: #fb7185;';
      amountHtml = `<span style="font-weight: 700; ${colorClass}">${sign}$${Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
    } else if (r.raw.monto) {
      amountHtml = `<span style="color: #fb7185;">${escapeHTML(r.raw.monto)}</span>`;
    }

    // Reason Diagnostic
    let reasonHtml = '';
    if (isValid) {
      reasonHtml = '<span class="reason-box-valid"><span>✔️</span> Listo para importar</span>';
    } else {
      reasonHtml = r.reasons.map(reason => `<div class="reason-box-rejected">⚠️ ${escapeHTML(reason)}</div>`).join('');
    }

    return `
      <tr style="${isValid ? '' : 'background: rgba(244, 63, 94, 0.04);'}">
        <td style="text-align: center; font-weight: 700; color: var(--text-dim);">${r.row_number}</td>
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-size: 12px; white-space: nowrap;">${fechaHtml}</td>
        <td>${flowBadge}</td>
        <td style="font-size: 12px; font-weight: 600;" title="${escapeHTML(banco)}">${bancoHtml}</td>
        <td style="font-size: 12px; font-family: monospace;">${docHtml}</td>
        <td style="text-align: right; font-size: 12px;">${amountHtml}</td>
        <td style="max-width: 340px;">${reasonHtml}</td>
      </tr>
    `;
  }).join('');
}

async function commitValidCsvRecords() {
  if (!verifiedCsvData || !verifiedCsvData.rows) return;

  const validRows = verifiedCsvData.rows.filter(r => r.status === 'valid');
  if (validRows.length === 0) {
    alert('No hay registros válidos para cargar.');
    return;
  }

  const btnCommit = document.getElementById('csv-modal-btn-commit');
  const commitText = document.getElementById('csv-commit-text');
  const spinner = document.getElementById('csv-commit-spinner');
  const footerNote = document.getElementById('csv-footer-note');

  if (btnCommit) btnCommit.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';
  if (commitText) commitText.textContent = `Insertando ${validRows.length} registros...`;
  if (footerNote) footerNote.innerHTML = '<span>⏳ Guardando registros en la base de datos y sincronizando con Supabase...</span>';

  try {
    const auth = getStoredAuth();
    const userId = auth && auth.user ? auth.user.id : 2;

    const payload = {
      action: 'commit',
      usuario_id: userId,
      records: validRows.map(r => r.data)
    };

    let res = null;

    // 1. Intentar guardar vía PHP si está disponible (entorno local XAMPP)
    try {
      const resp = await fetch('import_csv.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const text = await resp.text();
        if (text && text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.success) {
            res = parsed;
          }
        }
      }
    } catch (phpErr) {
      console.warn('import_csv.php no disponible (modo Vercel). Guardando directamente en Supabase...', phpErr);
    }

    // 2. Si backend PHP no respondió (despliegue en Vercel), insertar directamente en Supabase
    if (!res || !res.success) {
      if (!supabaseClient) {
        initSupabase();
      }
      if (!supabaseClient) {
        throw new Error('No se pudo conectar a Supabase para guardar los registros.');
      }

      const recordsToInsert = validRows.map(r => r.data);
      const BATCH_SIZE = 100;
      let insertedTotal = 0;

      for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
        const chunk = recordsToInsert.slice(i, i + BATCH_SIZE);
        const { error: insertErr } = await supabaseClient
          .from('fc_mov')
          .insert(chunk);

        if (insertErr) {
          throw new Error('Error al insertar en Supabase: ' + insertErr.message);
        }
        insertedTotal += chunk.length;
        if (commitText) {
          commitText.textContent = `Insertando ${insertedTotal} / ${recordsToInsert.length}...`;
        }
      }

      // Registrar auditoría en control_cambios de Supabase
      try {
        await supabaseClient.from('control_cambios').insert({
          tabla_afectada: 'fc_mov',
          registro_id: 0,
          operacion: 'INSERT_BATCH',
          usuario_id: userId,
          detalles_json: JSON.stringify({
            archivo: verifiedCsvData.filename,
            total_insertados: insertedTotal
          }),
          created_at: new Date().toISOString()
        });
      } catch (_) {}

      res = {
        success: true,
        inserted_count: insertedTotal,
        message: `Se insertaron exitosamente ${insertedTotal} movimientos en Supabase.`
      };
    }

    if (footerNote) {
      footerNote.innerHTML = `<span style="color: #34d399; font-weight: 700;">✅ ${escapeHTML(res.message || 'Carga completada exitosamente.')}</span>`;
    }
    if (commitText) commitText.textContent = '¡Carga Exitosa!';
    if (spinner) spinner.style.display = 'none';

    // Refresh Dashboard en vivo
    await fetchTableData();
    await updateAnalytics();
    if (typeof loadSummaryData === 'function') {
      await loadSummaryData();
    }

    setTimeout(() => {
      closeCsvModal();
      alert(`✅ ¡Carga completada con éxito!\n\nSe insertaron ${res.inserted_count || validRows.length} registros en la tabla fc_mov de Supabase.`);
    }, 800);

  } catch (err) {
    console.error('Error al confirmar carga CSV:', err);
    alert('Error al guardar movimientos: ' + (err.message || err));
    if (btnCommit) btnCommit.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (commitText) commitText.textContent = `Reintentar Carga (${validRows.length})`;
    if (footerNote) {
      footerNote.innerHTML = `<span style="color: #fb7185;">Error: ${escapeHTML(err.message || err)}</span>`;
    }
  }
}

function setupAuthEvents() {
  const loginForm = document.getElementById('login-form');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const rememberCheckbox = document.getElementById('login-remember');
  const errorBox = document.getElementById('login-error');
  const errorText = document.getElementById('login-error-text');
  const submitBtn = document.getElementById('btn-login-submit');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  const togglePassBtn = document.getElementById('btn-toggle-pass');
  const logoutBtn = document.getElementById('btn-logout');

  // Toggle password visibility
  if (togglePassBtn && passwordInput) {
    togglePassBtn.addEventListener('click', () => {
      const isPass = passwordInput.type === 'password';
      passwordInput.type = isPass ? 'text' : 'password';
      togglePassBtn.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Handle Login submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usuario = (usernameInput.value || '').trim();
      const clave = (passwordInput.value || '').trim();

      if (!usuario || !clave) {
        showLoginError('Por favor ingresa usuario y contraseña.');
        return;
      }

      // Loading state
      submitBtn.disabled = true;
      if (btnText) btnText.textContent = 'Verificando...';
      if (spinner) spinner.style.display = 'inline-block';
      if (errorBox) errorBox.style.display = 'none';

      try {
        let authResult = null;
        let isSuccess = false;

        // Intentar primero con backend PHP (para entorno local Apache / XAMPP)
        try {
          const resp = await fetch('login.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'login',
              usuario: usuario,
              clave: clave
            })
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data && data.success && data.user) {
              authResult = data;
              isSuccess = true;
            } else if (data && data.error) {
              showLoginError(data.error);
              return;
            }
          }
        } catch (phpErr) {
          console.warn('login.php no disponible (despliegue estático / Vercel). Verificando directamente contra Supabase...', phpErr);
        }

        // Si login.php no respondió (despliegue en Vercel sin PHP), consultar Supabase directamente
        if (!isSuccess) {
          if (!supabaseClient) {
            initSupabase();
          }

          if (supabaseClient) {
            const { data: users, error: supErr } = await supabaseClient
              .from('usuarios')
              .select('id, nombre, clave, created_at')
              .eq('nombre', usuario)
              .limit(1);

            if (supErr) {
              console.error('Error al consultar usuarios en Supabase:', supErr);
              showLoginError('Error al contactar con la base de datos de Supabase.');
              return;
            }

            if (users && users.length > 0) {
              const u = users[0];
              let match = false;

              // Si bcryptjs está disponible, validar hash
              const bcryptObj = (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) 
                ? dcodeIO.bcrypt 
                : (typeof window.bcrypt !== 'undefined' ? window.bcrypt : null);

              if (bcryptObj && u.clave) {
                try {
                  const normalizedHash = u.clave.replace(/^\$2y\$/, '$2a$');
                  match = bcryptObj.compareSync(clave, normalizedHash);
                } catch (bErr) {
                  console.warn('Error verificando bcrypt:', bErr);
                }
              }

              // Comparación directa en texto plano como respaldo
              if (!match && u.clave === clave) {
                match = true;
              }

              if (match) {
                isSuccess = true;
                authResult = {
                  success: true,
                  user: {
                    id: u.id,
                    nombre: u.nombre,
                    created_at: u.created_at
                  }
                };
              } else {
                showLoginError('Usuario o clave incorrectos.');
                return;
              }
            } else {
              showLoginError('Usuario o clave incorrectos.');
              return;
            }
          } else {
            showLoginError('No se pudo conectar a Supabase. Verifique las credenciales desencriptadas.');
            return;
          }
        }

        if (isSuccess && authResult && authResult.user) {
          // Success
          if (rememberCheckbox && rememberCheckbox.checked) {
            localStorage.setItem('flujocaja_auth', JSON.stringify(authResult));
          } else {
            sessionStorage.setItem('flujocaja_auth', JSON.stringify(authResult));
          }

          updateAuthUI(authResult.user);

          // Initialize Dashboard data if not already loaded
          if (!currentSummary) {
            await loadSummaryData();
            await fetchTableData();
          }
        }
      } catch (err) {
        console.error('Error de autenticación:', err);
        showLoginError('Error de conexión con el servidor de autenticación.');
      } finally {
        submitBtn.disabled = false;
        if (btnText) btnText.textContent = 'Iniciar Sesión';
        if (spinner) spinner.style.display = 'none';
      }
    });
  }

  // Handle Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('flujocaja_auth');
      sessionStorage.removeItem('flujocaja_auth');
      updateAuthUI(null);
      if (usernameInput) usernameInput.focus();
    });
  }

  function showLoginError(msg) {
    if (errorBox && errorText) {
      errorText.textContent = msg;
      errorBox.style.display = 'flex';
    }
  }
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupEvents();
  setupAuthEvents();
  updateActiveFiltersBadge();

  const ok = initSupabase();
  if (ok) {
    checkSupabaseConnection();
  }

  const storedAuth = getStoredAuth();
  if (storedAuth && storedAuth.user) {
    // Session exists
    updateAuthUI(storedAuth.user);
    await loadSummaryData();
    await fetchTableData();
  } else {
    // Keep blurred and show login modal
    updateAuthUI(null);
    const userField = document.getElementById('login-username');
    if (userField) userField.focus();
  }
});
