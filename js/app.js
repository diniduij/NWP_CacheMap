// Dexie DB setup
const db = new Dexie("LanduseDB");
db.version(1).stores({
  landuse: "landuse_id"  // primary key
});

// Map setup (WMS background for visualization)
const map = new ol.Map({
  target: 'map',
  layers: [
    new ol.layer.Image({
      source: new ol.source.ImageWMS({
        url: "http://yourserver/geoserver/landuse/wms",
        params: { LAYERS: "landuse:landuse_master" },
        ratio: 1,
        serverType: "geoserver"
      })
    })
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat([80.7, 7.8]),
    zoom: 8
  })
});

// Sync button: fetch WFS data and store offline
document.getElementById("sync").onclick = async () => {
  const url = "http://yourserver/geoserver/landuse/ows?" +
              "service=WFS&version=1.0.0&request=GetFeature" +
              "&typename=landuse:landuse_master" +
              "&outputFormat=application/json";

  try {
    const resp = await fetch(url);
    const geojson = await resp.json();

    await db.landuse.clear();
    for (const f of geojson.features) {
      await db.landuse.put({
        landuse_id: f.properties.landuse_id,
        properties: f.properties,
        geometry: f.geometry
      });
    }
    document.getElementById("status").innerText = "Status: Synced ✅";
  } catch (err) {
    document.getElementById("status").innerText = "Status: Sync failed ❌";
  }
};

// Offline search by landuse_id
document.getElementById("searchBtn").onclick = async () => {
  const id = document.getElementById("searchId").value.trim();
  if (!id) return;

  try {
    const record = await db.landuse.get(id);
    if (record) {
      document.getElementById("result").innerHTML =
        `<b>Landuse ID:</b> ${record.landuse_id}<br/>
         <pre>${JSON.stringify(record.properties, null, 2)}</pre>`;
    } else {
      document.getElementById("result").innerText = "No record found offline.";
    }
  } catch (err) {
    document.getElementById("result").innerText = "Error searching DB.";
  }
};

// Detect online/offline status
window.addEventListener("online", () => {
  document.getElementById("status").innerText = "Status: Online 🌐";
});
window.addEventListener("offline", () => {
  document.getElementById("status").innerText = "Status: Offline 📴";
});
