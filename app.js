// ============ Dexie DB ============
// Upgrade-safe: v1 (observations) existed; we add v2 with parcels.
const db = new Dexie("FieldAppDB");
db.version(1).stores({
  observations: 'temp_id, landuse_id, crop, season, area_ha, expected_yield, synced'
});
db.version(2).stores({
  observations: 'temp_id, landuse_id, crop, season, area_ha, expected_yield, synced',
  parcels: 'landuse_id' // stores WFS features as GeoJSON {properties, geometry}
});

// ============ Map ============
// Projections
proj4.defs("EPSG:3857","+proj=merc +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:4326","+proj=longlat +datum=WGS84 +no_defs");
ol.proj.proj4.register(proj4);

// GeoServer endpoints (EDIT THESE TO MATCH YOUR SERVER)
const WMS_URL = 'http://192.168.8.200:8080/geoserver/test/wms?';
const WFS_URL = 'http://192.168.8.200:8080/geoserver/test/ows?' +
  'service=WFS&version=1.0.0&request=GetFeature' +
  '&typename=test:landuse_master' +
  '&outputFormat=application/json';

// Map + layers
const base = new ol.layer.Tile({ source: new ol.source.OSM() });
const wmsLanduse = new ol.layer.Tile({
  source: new ol.source.TileWMS({
    url: WMS_URL,
    params: { 'LAYERS':'test:landuse_master','VERSION':'1.3.0','FORMAT':'image/png' },
    serverType: 'geoserver',
    crossOrigin: 'anonymous'
  }),
  opacity: 0.5
});

const vectorSource = new ol.source.Vector();
const defaultStyle = new ol.style.Style({
  stroke: new ol.style.Stroke({ width: 2 }),
  fill: new ol.style.Fill({ color: 'rgba(0,0,0,0.05)' })
});
const selectedStyle = new ol.style.Style({
  stroke: new ol.style.Stroke({ width: 3 }),
  fill: new ol.style.Fill({ color: 'rgba(255, 235, 59, 0.25)' })
});
const parcelsLayer = new ol.layer.Vector({
  source: vectorSource,
  style: defaultStyle
});

const map = new ol.Map({
  target: 'map',
  layers: [base, wmsLanduse, parcelsLayer],
  view: new ol.View({
    center: ol.proj.fromLonLat([80.7, 7.8]),
    zoom: 8
  })
});

// ============ UI Helpers ============
const $ = (id) => document.getElementById(id);
const setOnlineBadge = () => {
  const el = $('onlineStatus');
  if (navigator.onLine) { el.textContent = 'Online'; el.className='badge ok'; }
  else { el.textContent = 'Offline'; el.className='badge err'; }
};
window.addEventListener('online', setOnlineBadge);
window.addEventListener('offline', setOnlineBadge);
setOnlineBadge();

async function updateParcelCountBadge() {
  const n = await db.parcels.count();
  $('parcelStatus').textContent = `Parcels: ${n}`;
  $('parcelStatus').className = 'badge ' + (n>0 ? 'ok' : 'err');
}

// ============ Parcels: WFS Sync & Load ============
async function syncParcelsFromWFS() {
  try {
    $('output').textContent = '⏳ Fetching WFS…';
    const resp = await fetch(WFS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();

    // Store in IndexedDB
    await db.parcels.clear();
    const batch = geojson.features.map(f => ({
      landuse_id: f.properties.landuse_id,
      properties: f.properties,
      geometry: f.geometry
    }));
    await db.parcels.bulkPut(batch);

    // Draw on map
    await loadParcelsToMap();

    $('output').textContent = `✅ Parcels synced: ${batch.length}`;
  } catch (e) {
    console.error(e);
    $('output').textContent = `❌ Parcel sync failed: ${e.message}`;
  }
}

async function clearParcels() {
  await db.parcels.clear();
  vectorSource.clear();
  await updateParcelCountBadge();
  $('output').textContent = 'ℹ️ Cleared offline parcels.';
}

async function loadParcelsToMap() {
  vectorSource.clear();
  const all = await db.parcels.toArray();
  for (const rec of all) {
    const feature = new ol.format.GeoJSON().readFeature(
      { type:'Feature', geometry: rec.geometry, properties: { ...rec.properties, landuse_id: rec.landuse_id } },
      { dataProjection:'EPSG:3857', featureProjection:'EPSG:3857' } // your data is 3857
    );
    vectorSource.addFeature(feature);
  }
  await updateParcelCountBadge();
}

// ============ Map click: offline-first ============
let lastSelected = null;

map.on('singleclick', async (evt) => {
  // 1) Try offline vector first
  const feature = map.forEachFeatureAtPixel(evt.pixel, f => f, {
    layerFilter: (lyr) => lyr === parcelsLayer,
    hitTolerance: 5
  });

  if (feature) {
    if (lastSelected) lastSelected.setStyle(defaultStyle);
    feature.setStyle(selectedStyle);
    lastSelected = feature;

    const id = feature.get('landuse_id');
    $('landuse_id').value = id || '';
    $('output').textContent = id
      ? `🗺️ Selected landuse_id (offline): ${id}`
      : 'Feature has no landuse_id property';
    return;
  }

  // 2) If no offline parcel and online, try WMS GetFeatureInfo as a fallback
  if (navigator.onLine) {
    const viewResolution = map.getView().getResolution();
    const wmsSource = wmsLanduse.getSource();
    const url = wmsSource.getFeatureInfoUrl(evt.coordinate, viewResolution, 'EPSG:3857', {
      INFO_FORMAT: 'application/json'
    });
    if (url) {
      try {
        const r = await fetch(url);
        const data = await r.json();
        if (data.features && data.features.length > 0) {
          const landuse_id = data.features[0].properties.landuse_id;
          $('landuse_id').value = landuse_id || '';
          $('output').textContent = landuse_id
            ? `🌐 Selected landuse_id (WMS GFI): ${landuse_id}`
            : 'No landuse_id in WMS response.';
          return;
        }
      } catch (e) {
        console.error('GFI error', e);
      }
    }
  }

  $('output').textContent = 'No feature at this location.';
});

// ============ Records table ============
async function loadOfflineRecords() {
  const records = await db.observations.toArray();
  const tbody = $('offlineTbody');
  tbody.innerHTML = '';

  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No offline records saved.</td></tr>';
    return;
  }

  for (const rec of records) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${rec.landuse_id}</td>
      <td>${rec.crop}</td>
      <td>${rec.season}</td>
      <td>${Number(rec.area_ha).toFixed(2)}</td>
      <td>${Number(rec.expected_yield).toFixed(2)}</td>
      <td style="text-align:center;">${rec.synced ? '✅' : '❌'}</td>
    `;
    tbody.appendChild(tr);
  }
}
loadOfflineRecords();

// ============ Form save ============
$('attrForm').onsubmit = async (e) => {
  e.preventDefault();

  const landuse_id = $('landuse_id').value.trim();
  const crop = $('crop').value.trim();
  const season = $('season').value.trim();
  const area_ha_val = $('area_ha').value.trim();
  const expected_yield_val = $('expected_yield').value.trim();

  if (!landuse_id) { $('output').textContent = "❌ Please click a parcel to fill landuse_id."; return; }
  if (!crop || !season || !area_ha_val || !expected_yield_val) {
    $('output').textContent = "❌ Please fill all form fields."; return;
  }

  const area_ha = parseFloat(area_ha_val);
  const expected_yield = parseFloat(expected_yield_val);
  if (isNaN(area_ha) || isNaN(expected_yield)) {
    $('output').textContent = "❌ Area and Expected Yield must be numbers."; return;
  }

  const record = {
    temp_id: crypto.randomUUID(),
    landuse_id,
    crop,
    season,
    area_ha,
    expected_yield,
    synced: 0
  };

  try {
    await db.observations.add(record);
    $('output').textContent = "✅ Saved offline!";
    e.target.reset();
    $('landuse_id').value = '';
    loadOfflineRecords();
  } catch (err) {
    console.error("Dexie add error:", err);
    $('output').textContent = "❌ Failed to save offline.";
  }
};

// ============ Sync to server ============
$('syncRecordsBtn').onclick = async () => {
  try {
    const unsynced = await db.observations.where('synced').equals(0).toArray();
    if (unsynced.length === 0) { alert("✅ No data to sync."); return; }

    $('output').textContent = `⏳ Syncing ${unsynced.length} record(s)…`;

    const res = await fetch('sync.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: unsynced })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const result = await res.json();
    if (result.status === 'ok') {
      for (const r of unsynced) {
        await db.observations.update(r.temp_id, { synced: 1 });
      }
      $('output').textContent = "✅ Sync complete!";
      loadOfflineRecords();
    } else {
      throw new Error(result.message || "Server error");
    }
  } catch (error) {
    console.error("Sync failed:", error);
    $('output').textContent = "❌ Sync failed: " + error.message;
    alert("❌ Sync failed. Check console for details.");
  }
};

// ============ Utility buttons ============
$('syncParcelsBtn').onclick = syncParcelsFromWFS;
$('clearParcelsBtn').onclick = clearParcels;

$('clearRecordsBtn').onclick = async () => {
  if (confirm('Clear ALL locally saved records?')) {
    await db.observations.clear();
    loadOfflineRecords();
    $('output').textContent = '🧹 Cleared local records.';
  }
};

// ============ Initial load ============
loadParcelsToMap().then(() => {
  if (vectorSource.getFeatures().length === 0) {
    $('output').textContent = 'ℹ️ No offline parcels yet. Click “Sync Parcels (WFS → Offline)” while online.';
  }
});
updateParcelCountBadge();
