let map, hexLayer;

const GeoUtils = {
  EARTH_RADIUS_METERS: 6371000,

  radiansToDegrees: (r) => (r * 180) / Math.PI,
  degreesToRadians: (d) => (d * Math.PI) / 180,

  getDistanceOnEarthInMeters: (lat1, lon1, lat2, lon2) => {
    const lat1Rad = GeoUtils.degreesToRadians(lat1);
    const lat2Rad = GeoUtils.degreesToRadians(lat2);
    const lonDelta = GeoUtils.degreesToRadians(lon2 - lon1);
    const x =
      Math.sin(lat1Rad) * Math.sin(lat2Rad) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lonDelta);
    return (
      GeoUtils.EARTH_RADIUS_METERS * Math.acos(Math.max(Math.min(x, 1), -1))
    );
  },
};

// Get the coordinates for a simple bounding box
const getSimpleLatLngBounds = (lat, lng, zoomLevel) => {
  const pi = 3.14;
  const R = 6371e3;

  let radius;
  if (zoomLevel >= 15) {
    radius = 2000;
  } else if (zoomLevel >= 14) {
    radius = 4000;
  } else if (zoomLevel >= 9) {
    radius = 8000;
  } else {
    radius = 36000;
  }

  const minLat = +lat - ((radius / R) * 180) / pi;
  const maxLat = +lat + ((radius / R) * 180) / pi;
  const minLng = +lng - ((radius / R) * 180) / pi / Math.cos((+lat * pi) / 180);
  const maxLng = +lng + ((radius / R) * 180) / pi / Math.cos((+lat * pi) / 180);

  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
  };
};

const ZOOM_TO_H3_RES_CORRESPONDENCE = {
  5: 1,
  6: 2,
  7: 3,
  8: 3,
  9: 6,
  10: 6,
  11: 6,
  12: 6,
  13: 7,
  14: 8,
  15: 8,
  16: 8,
  17: 8,
  18: 8,
  19: 8,
  20: 8,
  21: 8,
  22: 8,
  23: 8,
  24: 8,
};

const H3_RES_TO_ZOOM_CORRESPONDENCE = {};
for (const [zoom, res] of Object.entries(ZOOM_TO_H3_RES_CORRESPONDENCE)) {
  H3_RES_TO_ZOOM_CORRESPONDENCE[res] = zoom;
}

const getH3ResForMapZoom = (mapZoom) => {
  return ZOOM_TO_H3_RES_CORRESPONDENCE[mapZoom] ?? 1;
};

const h3BoundsToPolygon = (lngLatH3Bounds) => {
  lngLatH3Bounds.push(lngLatH3Bounds[0]); // "close" the polygon
  return lngLatH3Bounds;
};

/**
 * Parse the current Query String and return its components as an object.
 */
const parseQueryString = () => {
  const queryString = window.location.search;
  const query = {};
  const pairs = (
    queryString[0] === "?" ? queryString.substr(1) : queryString
  ).split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split("=");
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
  }
  return query;
};

const queryParams = parseQueryString();

const copyToClipboard = (text) => {
  const dummy = document.createElement("textarea");
  document.body.appendChild(dummy);
  dummy.value = text;
  dummy.select();
  document.execCommand("copy");
  document.body.removeChild(dummy);
};

var app = new Vue({
  el: "#app",

  data: {
    searchH3Id: undefined,
    gotoLatLon: undefined,
    currentH3Res: undefined,
    currentZoomLevel: undefined,
  },

  computed: {},

  methods: {
    computeAverageEdgeLengthInMeters: function (vertexLocations) {
      let totalLength = 0;
      let edgeCount = 0;
      for (let i = 1; i < vertexLocations.length; i++) {
        const [fromLat, fromLng] = vertexLocations[i - 1];
        const [toLat, toLng] = vertexLocations[i];
        const edgeDistance = GeoUtils.getDistanceOnEarthInMeters(
          fromLat,
          fromLng,
          toLat,
          toLng
        );
        totalLength += edgeDistance;
        edgeCount++;
      }
      return totalLength / edgeCount;
    },

    updateMapDisplay: function () {
      if (hexLayer) {
        hexLayer.remove();
      }

      hexLayer = L.layerGroup().addTo(map);

      const zoom = map.getZoom();
      this.currentZoomLevel = zoom;
      this.currentH3Res = getH3ResForMapZoom(zoom);

      const { lat, lng } = map.getCenter();

      const cellId = h3.latLngToCell(lat, lng, this.currentH3Res);

      const grid = h3.gridDisk(cellId, 1);

      const h3s = h3.compactCells(grid);

      for (const h3id of h3s) {
        const polygonLayer = L.layerGroup().addTo(hexLayer);

        const isSelected = h3id === this.searchH3Id;

        const style = isSelected ? { fillColor: "orange" } : {};

        const h3Bounds = h3.cellToBoundary(h3id);
        const averageEdgeLength =
          this.computeAverageEdgeLengthInMeters(h3Bounds);
        const cellArea = h3.cellArea(h3id, "m2");

        const tooltipText = `
                Cell ID: <b>${h3id}</b>
                <br />
                Average edge length (m): <b>${averageEdgeLength.toLocaleString()}</b>
                <br />
                Cell area (m^2): <b>${cellArea.toLocaleString()}</b>
                `;

        const h3Polygon = L.polygon(h3BoundsToPolygon(h3Bounds), style)
          .on("click", () => copyToClipboard(h3id))
          .bindTooltip(tooltipText)
          .addTo(polygonLayer);

        // less SVG, otherwise perf is bad
        if (Math.random() > 0.8 || isSelected) {
          var svgElement = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
          );
          svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          svgElement.setAttribute("viewBox", "0 0 200 200");
          svgElement.innerHTML = `<text x="20" y="70" class="h3Text">${h3id}</text>`;
          var svgElementBounds = h3Polygon.getBounds();
          L.svgOverlay(svgElement, svgElementBounds).addTo(polygonLayer);
        }
      }

      const { minLat, maxLat, minLng, maxLng } = getSimpleLatLngBounds(
        lat,
        lng,
        this.currentZoomLevel
      );
      const boundingBoxLayer = L.layerGroup().addTo(hexLayer);
      L.polygon(
        [
          [minLat, minLng],
          [minLat, maxLng],
          [maxLat, maxLng],
          [maxLat, minLng],
        ],
        { color: "#CC5500" }
      ).addTo(boundingBoxLayer);
    },

    gotoLocation: function () {
      const [lat, lon] = (this.gotoLatLon || "").split(",").map(Number);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat <= 90 &&
        lat >= -90 &&
        lon <= 180 &&
        lon >= -180
      ) {
        map.setView([lat, lon], 16);
      }
    },

    findH3: function () {
      if (!h3.isValidCell(this.searchH3Id)) {
        return;
      }
      const h3Boundary = h3.cellToBoundary(this.searchH3Id);

      let bounds = undefined;

      for ([lat, lng] of h3Boundary) {
        if (bounds === undefined) {
          bounds = new L.LatLngBounds([lat, lng], [lat, lng]);
        } else {
          bounds.extend([lat, lng]);
        }
      }

      map.fitBounds(bounds);

      const newZoom =
        H3_RES_TO_ZOOM_CORRESPONDENCE[h3.getResolution(this.searchH3Id)];
      map.setZoom(newZoom);
    },
  },

  beforeMount() {},

  mounted() {
    document.addEventListener("DOMContentLoaded", () => {
      map = L.map("mapid");

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 5,
        maxNativeZoom: 19,
        maxZoom: 24,
        attribution:
          '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      pointsLayer = L.layerGroup([]).addTo(map);

      const initialZoom = queryParams.zoom ?? 5;
      const initialLat = queryParams.lat ?? 52;
      const initialLng = queryParams.lng ?? 5.1;
      map.setView([initialLat, initialLng], initialZoom);
      map.on("zoomend", this.updateMapDisplay);
      map.on("moveend", this.updateMapDisplay);

      const { h3 } = queryParams;
      console.log(h3);
      if (h3) {
        this.searchH3Id = h3;
        window.setTimeout(() => this.findH3(), 50);
      }

      this.updateMapDisplay();
    });
  },
});
