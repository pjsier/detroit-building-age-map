import maplibregl from "maplibre-gl"

import { setupGeocoder } from "./geocoder"
import * as pmtiles from "pmtiles"

import "maplibre-gl/dist/maplibre-gl.css"
import "./css/style.css"

const mapContainer = document.getElementById("map")

const TOOLTIP_LAYERS = ["buildings"]

let mapData = { hoverId: null, clickId: null, clickFeat: null }

let protocol = new pmtiles.Protocol()
maplibregl.addProtocol("pmtiles", protocol.tile)

const map = new maplibregl.Map({
  container: mapContainer,
  style: "style.json",
  center: [-83.08193, 42.37004],
  zoom: 11,
  minZoom: 11,
  maxZoom: 18,
  hash: true,
  dragRotate: false,
  attributionControl: true,
})

map.touchZoomRotate.disableRotation()

function checkWebPSupport() {
  return new Promise((resolve) => {
    const webP = new Image()
    webP.src =
      "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA"
    webP.onload = webP.onerror = () => resolve(webP.height === 2)
  })
}

map.once("styledata", () => {
  checkWebPSupport().then((webPSupported) => {
    if (webPSupported) return

    const layers = map.getStyle().layers
    const layerIdx = layers.findIndex(({ id }) => id === "buildings-raster")
    const layer = layers[layerIdx]
    const before = layers[layerIdx + 1].id
    layer.source = "buildings-raster-png"
    map.removeLayer("buildings-raster")
    map.addLayer(layer, before)
  })
})

const isMobile = () => window.innerWidth <= 600

const hoverPopup = new maplibregl.Popup({
  closeButton: false,
  closeOnClick: false,
})

const clickPopup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
})

const popupContent = (features) =>
  features
    .map(
      ({ properties }) => `<p><strong>Address</strong> ${properties.address}</p>
    <p><strong>PIN</strong> ${properties.parcel_id}</p>
    <p><strong>Year built</strong> ${properties.year_built || "Not available"}</p>`
    )
    .join("")

const removePopup = (popup) => {
  map.getCanvas().style.cursor = ""
  popup.remove()
}

const handleFeaturesHover = (features) => {
  if (mapData.hoverId) {
    map.setFeatureState(
      { source: "buildings", sourceLayer: "buildings", id: mapData.hoverId },
      { hover: false }
    )
  }
  if (features.length > 0) {
    map.setFeatureState(
      { source: "buildings", sourceLayer: "buildings", id: features[0].id },
      { hover: true }
    )
    mapData.hoverId = features[0].id
  }
}

const handleFeaturesClick = (features) => {
  if (features.length === 0) {
    map.setFeatureState(
      {
        source: "buildings",
        sourceLayer: "buildings",
        id: mapData.clickId,
      },
      { click: false }
    )
    mapData.clickId = null
    mapData.clickFeat = null
  } else {
    map.setFeatureState(
      {
        source: "buildings",
        sourceLayer: "buildings",
        id: features[0].id,
      },
      { click: true }
    )
    mapData.clickId = features[0].id
    mapData.clickFeat = features[0]
  }
}

clickPopup.on("close", () => handleFeaturesClick([]))

const onMouseMove = (e) => {
  const features = map.queryRenderedFeatures(e.point, {
    layers: TOOLTIP_LAYERS,
  })
  handleFeaturesHover(features)
  if (features.length > 0 && !clickPopup.isOpen()) {
    map.getCanvas().style.cursor = "pointer"
    if (!isMobile()) {
      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`<div class="popup hover">${popupContent(features)}</div>`)
        .addTo(map)
    }
  } else {
    removePopup(hoverPopup)
  }
}

const onMouseOut = () => {
  handleFeaturesHover([])
  removePopup(hoverPopup)
}

const onMapClick = (e) => {
  const features = map.queryRenderedFeatures(e.point, {
    layers: TOOLTIP_LAYERS,
  })
  handleFeaturesHover(features)
  handleFeaturesClick(clickPopup.isOpen() ? [] : features)
  if (features.length > 0) {
    map.getCanvas().style.cursor = "pointer"
    removePopup(hoverPopup)
    clickPopup
      .setLngLat(e.lngLat)
      .setHTML(`<div class="popup click">${popupContent(features)}</div>`)
      .addTo(map)
  }
}

TOOLTIP_LAYERS.forEach((layer) => {
  map.on("mousemove", layer, onMouseMove)
  map.on("mouseout", layer, onMouseOut)
  map.on("click", layer, onMapClick)
})

setupGeocoder(({ lat, lon }) => {
  clickPopup.remove()
  map.flyTo({
    center: [lon, lat],
    zoom: 16,
  })
  map.resize()

  map.once("idle", () => {
    onMapClick({ point: map.project([lon, lat]), lngLat: [lon, lat] })
  })
})
