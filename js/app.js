const map = L.map('map', { zoomControl: true }).setView([-12.8, -40.2], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const clusters = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  chunkedLoading: true
});
map.addLayer(clusters);

const datasets = [];
let userMarker = null;
let userCircle = null;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toFixed(6);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function popupHtml(point) {
  const destination = encodeURIComponent(`${point.lat},${point.lon}`);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  return `<div class="popup-title">${escapeHtml(point.nome)}</div>
    <div class="popup-sub">${escapeHtml(point.cidade || '')}</div>
    <div class="popup-coord">${fmt(point.lat)}, ${fmt(point.lon)}</div>
    <a class="popup-btn" href="${url}" target="_blank" rel="noopener">Traçar rota no Google Maps ↗</a>`;
}

async function loadCatalog() {
  const response = await fetch('dados/catalogo.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar catálogo (${response.status})`);
  const catalog = await response.json();

  if (!Array.isArray(catalog.arquivos)) {
    throw new Error('O catálogo precisa conter uma lista "arquivos".');
  }

  const results = await Promise.all(catalog.arquivos.map(async file => {
    try {
      const response = await fetch(`dados/${encodeURIComponent(file)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.locais)) throw new Error('JSON sem lista "locais".');
      return { file, data, error: null, enabled: false };
    } catch (error) {
      return { file, data: null, error: error.message, enabled: false };
    }
  }));

  datasets.push(...results);
  renderDatasetList();
  refreshMarkers();
}

function renderDatasetList() {
  const container = $('dataset-list');
  container.replaceChildren();

  const valid = datasets.filter(item => item.data);
  $('dataset-count').textContent = `(${valid.length} disponível(is))`;

  if (!datasets.length) {
    container.innerHTML = '<p class="muted">Nenhum conjunto cadastrado no catálogo.</p>';
    return;
  }

  datasets.forEach((item, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'dataset-item';

    if (item.error) {
      wrapper.innerHTML = `<div class="dataset-title">${escapeHtml(item.file)}</div>
        <p class="muted">Não foi possível carregar: ${escapeHtml(item.error)}</p>`;
    } else {
      const title = item.data.titulo || item.file;
      const description = item.data.descricao || 'Sem descrição.';
      const count = item.data.locais.length;

      wrapper.innerHTML = `
        <label class="dataset-heading">
          <input type="checkbox" data-index="${index}" ${item.enabled ? 'checked' : ''}>
          <span class="dataset-title">${escapeHtml(title)}</span>
        </label>
        <div class="dataset-description">${escapeHtml(description)}</div>
        <div class="dataset-count">${count} local(is)</div>`;
    }
    container.appendChild(wrapper);
  });

  container.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      datasets[Number(input.dataset.index)].enabled = input.checked;
      refreshMarkers();
    });
  });
}

function refreshMarkers() {
  clusters.clearLayers();
  const query = $('search').value.trim().toLocaleLowerCase('pt-BR');
  let totalEnabled = 0;
  let visible = 0;
  const bounds = [];

  datasets.forEach(dataset => {
    if (!dataset.enabled || !dataset.data) return;
    totalEnabled += dataset.data.locais.length;

    dataset.data.locais.forEach(point => {
      const searchable = `${point.nome || ''} ${point.cidade || ''}`.toLocaleLowerCase('pt-BR');
      if (query && !searchable.includes(query)) return;
      if (!Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) return;

      const marker = L.marker([Number(point.lat), Number(point.lon)], {
        title: point.nome || 'Posto'
      });
      marker.bindPopup(popupHtml(point));
      clusters.addLayer(marker);
      bounds.push([Number(point.lat), Number(point.lon)]);
      visible++;
    });
  });

  $('count').textContent = `${visible} de ${totalEnabled} locais exibidos`;
  if (query && visible === 1 && bounds.length) map.setView(bounds[0], 15);
}

function locate() {
  const status = $('status');
  if (!navigator.geolocation) {
    status.textContent = 'GPS indisponível neste navegador';
    return;
  }

  status.textContent = 'Obtendo GPS…';
  navigator.geolocation.getCurrentPosition(position => {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;

    if (userMarker) map.removeLayer(userMarker);
    if (userCircle) map.removeLayer(userCircle);

    userMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      }),
      zIndexOffset: 1000
    }).bindPopup(`Você está aqui<br>Precisão aproximada: ${Math.round(position.coords.accuracy)} m`).addTo(map);

    userCircle = L.circle([lat, lon], {
      radius: position.coords.accuracy,
      color: '#28a7ff',
      weight: 1,
      fillOpacity: 0.08
    }).addTo(map);

    map.setView([lat, lon], 13);
    status.textContent = `GPS ativo · precisão ${Math.round(position.coords.accuracy)} m`;
  }, error => {
    status.textContent = error.code === 1
      ? 'Permita o acesso à localização'
      : 'Não foi possível obter o GPS';
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
}

$('gps').addEventListener('click', locate);
$('search').addEventListener('input', refreshMarkers);

loadCatalog().catch(error => {
  $('dataset-list').innerHTML = `<p class="muted">Erro ao carregar catálogo: ${escapeHtml(error.message)}</p>`;
  $('count').textContent = 'Não foi possível carregar os conjuntos';
});
