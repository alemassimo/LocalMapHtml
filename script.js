function togglePanel(header) {
    const content = header.nextElementSibling;
    content.classList.toggle('active');
}

var map = L.map('map', { attributionControl: false }).setView([45.0, 10.0], 6); // initial center
// Base layer OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18
}).addTo(map);
// Layer OpenSeaMap (overlay)
L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18,
    transparent: true
}).addTo(map);

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        coordsLocked = !coordsLocked;
        const coordsDiv = document.getElementById('mouse-coords');
        if (coordsLocked && lockedCoords) {
            const text = `${lockedCoords.lat.toFixed(6)} ${lockedCoords.lng.toFixed(6)}`;
            coordsDiv.textContent = text;
            coordsDiv.classList.add('locked');
            // Copy to clipboard
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => {
                    // Optional: show visual feedback
                    coordsDiv.textContent = text + " (copied)";
                    setTimeout(() => {
                        coordsDiv.textContent = text;
                    }, 1200);
                });
            }
        } else {
            coordsDiv.classList.remove('locked');
        }
        e.preventDefault();
    }
});

map.on('mousemove', function (e) {
    if (!coordsLocked) {
        const coordsDiv = document.getElementById('mouse-coords');
        coordsDiv.textContent =
            `Lat: ${e.latlng.lat.toFixed(6)}, Lon: ${e.latlng.lng.toFixed(6)} CTRL + L to lock`;
        coordsDiv.classList.remove('locked');
        lockedCoords = e.latlng;
    }
});

var poligoni = [];
var coordList = [];
var segnaposti = [];
var circleList = [];
var labels = [];
var lineDrawingEnabled = false;
var lines = [];
var currentLine = null;
var coordsLocked = false;
var lockedCoords = null;
var tempLine = null;
var eraserEnabled = false;

// Add listener for "Add Label" button
document.getElementById('addLabelBtn').addEventListener('click', function () {
    const coordInput = document.getElementById('coordinateLabel').value.trim();
    const labelText = document.getElementById('labelText').value.trim();

    if (!coordInput) {
        alert("Enter a valid coordinate.");
        return;
    }

    if (!labelText) {
        alert("Enter label text.");
        return;
    }

    const parsed = parseCoordinate(coordInput);
    if (!parsed) {
        alert("Coordinate format error.");
        return;
    }

    const lat = parseFloat(parsed[0]);
    const lon = parseFloat(parsed[1]);

    // Add label as permanent popup
    const labelPopup = L.popup({
        closeButton: false,
        autoClose: false,
        closeOnClick: false
    })
        .setLatLng([lat, lon])
        .setContent(labelText)
        .addTo(map);

    // Store label
    const labelObj = { coord: parsed, text: labelText, id: Date.now() + Math.random(), layer: labelPopup };

    labels.push(labelObj);

    // Add entry to label list
    aggiungiVoceListaLabel(labelObj);

    // Center map on label
    map.setView([lat, lon]);
});

// Calculate distance between two points in nautical miles
function distanzaNM(latlng1, latlng2) {
    const R = 6371e3; // earth radius in meters
    const toRad = x => x * Math.PI / 180;
    const φ1 = toRad(latlng1.lat);
    const φ2 = toRad(latlng2.lat);
    const Δφ = toRad(latlng2.lat - latlng1.lat);
    const Δλ = toRad(latlng2.lng - latlng1.lng);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // distance in meters
    return d / 1852; // in nautical miles
}

// Calculate bearing (direction) between two points in degrees
function bearing(latlng1, latlng2) {
    const toRad = x => x * Math.PI / 180;
    const toDeg = x => x * 180 / Math.PI;
    const φ1 = toRad(latlng1.lat);
    const φ2 = toRad(latlng2.lat);
    const Δλ = toRad(latlng2.lng - latlng1.lng);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    let θ = Math.atan2(y, x);
    θ = toDeg(θ);
    return (θ + 360) % 360;
}

function toggleEraserMode() {
    eraserEnabled = !eraserEnabled;
    const mapDiv = document.getElementById('map');
    if (eraserEnabled) {
        mapDiv.classList.add('eraser-cursor');
        // Enable eraser on all existing lines
        lines.forEach(function (line) {
            line.on('click', eraserHandler);
        });
    } else {
        mapDiv.classList.remove('eraser-cursor');
        // Disable eraser on all lines
        lines.forEach(function (line) {
            line.off('click', eraserHandler);
        });
    }
}

function eraserHandler(e) {
    if (eraserEnabled) {
        map.removeLayer(this);
        // Remove line from lines array
        lines = lines.filter(l => l !== this);
    }
}

function toggleLineDrawingMode() {
    lineDrawingEnabled = !lineDrawingEnabled;
    const mapDiv = document.getElementById('map');
    if (lineDrawingEnabled) {
        map.on('click', startLine);
        mapDiv.classList.add('line-draw-cursor');
    } else {
        map.off('click', startLine);
        mapDiv.classList.remove('line-draw-cursor');
        if (currentLine) {
            map.removeLayer(currentLine);
            currentLine = null;
        }
        // Remove temp line if present
        if (tempLine) {
            map.removeLayer(tempLine);
            tempLine = null;
        }
        map.off('mousemove', updateTempLine);
        map.off('click', finishLine);
    }
}

function startLine(e) {
    if (!currentLine) {
        currentLine = L.polyline([e.latlng], { color: 'blue' }).addTo(map);

        // Create temp line
        tempLine = L.polyline([e.latlng, e.latlng], { color: 'blue', dashArray: '5, 10' }).addTo(map);

        // Update temp line as mouse moves
        map.on('mousemove', updateTempLine);

        map.on('click', finishLine);
    }
}

function updateTempLine(e) {
    if (tempLine && currentLine) {
        const start = currentLine.getLatLngs()[0];
        tempLine.setLatLngs([start, e.latlng]);
    }
}

function finishLine(e) {
    if (currentLine) {
        currentLine.addLatLng(e.latlng);
        lines.push(currentLine);

        // Remove temp line
        if (tempLine) {
            map.removeLayer(tempLine);
            tempLine = null;
        }
        map.off('mousemove', updateTempLine);

        // ...rest of your finishLine code...
        const latlngs = currentLine.getLatLngs();
        if (latlngs.length >= 2) {
            const start = latlngs[0];
            const end = latlngs[latlngs.length - 1];
            const lunghezza = distanzaNM(start, end).toFixed(2);
            const dir1 = bearing(start, end).toFixed(1);
            const dir2 = bearing(end, start).toFixed(1);

            currentLine.bindPopup(
                `Length: <b>${lunghezza} NM</b><br>` +
                `Direction: <b>${dir1}°</b> / <b>${dir2}°</b>`
            );
        }

        currentLine.on('click', function (e) {
            if (eraserEnabled) {
                eraserHandler.call(this, e);
            } else {
                this.openPopup(e.latlng);
            }
        });

        if (eraserEnabled) {
            currentLine.on('click', eraserHandler);
        }

        currentLine = null;
        map.off('click', finishLine);
    }
}

function clearLines() {
    lines.forEach(function (line) {
        map.removeLayer(line);
    });
    lines = [];
}

document.getElementById('addSegnapostoBtn').addEventListener('click', function () {
    const coordInput = document.getElementById('coordinateSegnaposto').value.trim();
    const imageInput = document.getElementById('imageUpload').files[0];

    if (!coordInput) {
        alert("Enter a valid coordinate.");
        return;
    }

    if (!imageInput) {
        alert("Upload an image for the marker.");
        return;
    }

    const parsed = parseCoordinate(coordInput);
    if (!parsed) {
        alert("Coordinate format error.");
        return;
    }

    const lat = parseFloat(parsed[0]);
    const lon = parseFloat(parsed[1]);

    const reader = new FileReader();
    reader.onload = function (event) {
        const imageUrl = event.target.result;

        // Create custom icon with uploaded image
        const customIcon = L.icon({
            iconUrl: imageUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
        });

        // Add marker with custom icon
        const marker = L.marker([lat, lon], { icon: customIcon }).addTo(map);

        // Store marker
        const segnapostoObj = { coord: parsed, icon: customIcon, id: Date.now() + Math.random(), layer: marker };
        segnaposti.push(segnapostoObj);

        // Add entry to marker list
        aggiungiVoceListaSegnaposto(segnapostoObj);

        // Center map on marker
        map.setView([lat, lon]);
    };

    reader.readAsDataURL(imageInput);
});

document.getElementById('addAreaBtn').addEventListener('click', function () {
    const coordInput = document.getElementById('coordinate').value.trim();
    const radiusInput = document.getElementById('radius').value.trim();

    if (!coordInput) {
        alert("Enter a valid coordinate.");
        return;
    }

    if (!radiusInput) {
        alert("Enter a valid radius.");
        return;
    }

    const parsed = parseCoordinate(coordInput);
    if (!parsed) {
        alert("Coordinate format error.");
        return;
    }

    const lat = parseFloat(parsed[0]);
    const lon = parseFloat(parsed[1]);
    const radius = parseFloat(radiusInput);

    // Add circle to map
    const circle = L.circle([lat, lon], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.5,
        radius: radius * 1852 // Convert nautical miles to meters
    }).addTo(map);

    // Store circle
    const circleObj = { coord: parsed, radius: radius, id: Date.now() + Math.random(), layer: circle };
    circleList.push(circleObj);

    // Add entry to circle list
    aggiungiVoceListaCircle(circleObj);

    // Center map on circle
    map.setView([lat, lon]);
});

function aggiungiCoordinate() {
    const input = document.getElementById('coordinateInput').value.trim();
    if (!input) {
        alert("Enter at least one coordinate.");
        return;
    }

    const lines = input.split('\n');
    const coords = [];

    for (let line of lines) {
        const parsed = parseCoordinate(line);
        if (!parsed) {
            alert("Coordinate format error: " + line);
            return;
        }
        coords.push(parsed);
    }

    const polygon = L.polygon(coords, { color: 'blue' }).addTo(map);
    poligoni.push(polygon);

    // Add coordinates to list
    coords.forEach(coord => {
        const coordObj = { coord: coord, id: Date.now() + Math.random() };
        coordList.push(coordObj);
        aggiungiVoceListaCoord(coordObj);
    });

    // Center map on polygon
    if (coords.length > 0) {
        map.setView(coords[0]);
    }
}

function aggiungiVoceListaCoord(coordObj) {
    const li = document.createElement('li');
    li.textContent = coordObj.coord.join(', ');
    li.dataset.id = coordObj.id;
    li.addEventListener('click', function () {
        const index = coordList.findIndex(c => c.id === coordObj.id);
        if (index !== -1) {
            map.removeLayer(poligoni[index]);
            poligoni.splice(index, 1);
            coordList.splice(index, 1);
            li.remove();
        }
    });
    document.getElementById('listaCoord').appendChild(li);
}

function aggiungiVoceListaCircle(circleObj) {
    const li = document.createElement('li');
    li.textContent = circleObj.coord.join(', ') + " - Radius: " + circleObj.radius + " NM";
    li.dataset.id = circleObj.id;
    li.addEventListener('click', function () {
        const index = circleList.findIndex(c => c.id === circleObj.id);
        if (index !== -1) {
            map.removeLayer(circleList[index].layer);
            circleList.splice(index, 1);
            li.remove();
        }
    });
    document.getElementById('listaCircles').appendChild(li);
}

function aggiungiVoceListaSegnaposto(segnapostoObj) {
    const li = document.createElement('li');
    li.textContent = segnapostoObj.coord.join(', ');
    li.dataset.id = segnapostoObj.id;
    li.addEventListener('click', function () {
        const index = segnaposti.findIndex(s => s.id === segnapostoObj.id);
        if (index !== -1) {
            map.removeLayer(segnaposti[index].layer);
            segnaposti.splice(index, 1);
            li.remove();
        }
    });
    document.getElementById('listaSegnaposto').appendChild(li);
}

function aggiungiVoceListaLabel(labelObj) {
    const li = document.createElement('li');
    li.textContent = labelObj.coord.join(', ') + " - " + labelObj.text;
    li.dataset.id = labelObj.id;
    li.addEventListener('click', function () {
        const index = labels.findIndex(l => l.id === labelObj.id);
        if (index !== -1) {
            map.removeLayer(labels[index].layer);
            labels.splice(index, 1);
            li.remove();
        }
    });
    document.getElementById('listaLabels').appendChild(li);
}

function parseCoordinate(coord) {
    // Remove extra spaces and convert to uppercase for consistency
    coord = coord.trim().toUpperCase().replace(/\s+/g, ' ');
    
    // Try DMS format first (e.g., "47 32.00N 011 40.00W" or "47-32.00N 011-40.00E")
    const dmsRegex = /(\d{1,3})[-\s](\d{1,2}\.?\d*)([NS])\s+(\d{1,3})[-\s](\d{1,2}\.?\d*)([EW])/;
    const dmsMatch = coord.match(dmsRegex);
    
    if (dmsMatch) {
        const latDeg = parseFloat(dmsMatch[1]);
        const latMin = parseFloat(dmsMatch[2]);
        const latDir = dmsMatch[3];
        const lonDeg = parseFloat(dmsMatch[4]);
        const lonMin = parseFloat(dmsMatch[5]);
        const lonDir = dmsMatch[6];
        
        // Convert degrees-minutes to decimal degrees
        let lat = latDeg + (latMin / 60);
        let lon = lonDeg + (lonMin / 60);
        
        // Apply direction signs
        if (latDir === 'S') lat = -lat;
        if (lonDir === 'W') lon = -lon;
        
        return [lat, lon];
    }
    
    // Try simple decimal format (e.g., "45.5, 10.2" or "45.5 10.2")
    const decimalRegex = /(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)/;
    const decimalMatch = coord.match(decimalRegex);
    if (decimalMatch) {
        return [parseFloat(decimalMatch[1]), parseFloat(decimalMatch[2])];
    }
    
    return null;
}

function resetAll() {
    // Remove all polygons
    poligoni.forEach(polygon => map.removeLayer(polygon));
    poligoni = [];
    coordList = [];
    document.getElementById('listaCoord').innerHTML = '';

    // Remove all circles
    circleList.forEach(circle => map.removeLayer(circle.layer));
    circleList = [];
    document.getElementById('listaCircles').innerHTML = '';

    // Remove all markers
    segnaposti.forEach(segnaposto => map.removeLayer(segnaposto.layer));
    segnaposti = [];
    document.getElementById('listaSegnaposto').innerHTML = '';

    // Remove all labels
    labels.forEach(label => map.removeLayer(label.layer));
    labels = [];
    document.getElementById('listaLabels').innerHTML = '';

    // Remove all lines
    clearLines();
}

document.getElementById('saveJsonBtn').addEventListener('click', function () {
    const data = {
        polygons: poligoni.map(p => p.getLatLngs()[0].map(ll => [ll.lat, ll.lng])),
        circles: circleList.map(c => ({
            coord: c.coord,
            radius: c.radius
        })),
        labels: labels.map(l => ({
            coord: l.coord,
            text: l.text
        })),
        lines: lines.map(line => line.getLatLngs().map(ll => [ll.lat, ll.lng])),
        markers: segnaposti.map(m => ({
            coord: m.coord,
            image: m.icon.options.iconUrl // base64 string
        }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "map_data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('loadJsonBtn').addEventListener('click', function () {
    document.getElementById('loadJsonInput').click();
});

document.getElementById('loadJsonInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (event) {
        try {
            const data = JSON.parse(event.target.result);
            resetAll();

            // Polygons
            if (data.polygons) {
                data.polygons.forEach(coords => {
                    const latlngs = coords.map(c => ({ lat: c[0], lng: c[1] }));
                    const polygon = L.polygon(latlngs, { color: 'blue' }).addTo(map);
                    poligoni.push(polygon);
                    latlngs.forEach(coord => {
                        const coordObj = { coord: [coord.lat, coord.lng], id: Date.now() + Math.random() };
                        coordList.push(coordObj);
                        aggiungiVoceListaCoord(coordObj);
                    });
                });
            }

            // Circles
            if (data.circles) {
                data.circles.forEach(c => {
                    const circle = L.circle(c.coord, {
                        color: 'red',
                        fillColor: '#f03',
                        fillOpacity: 0.5,
                        radius: c.radius * 1852
                    }).addTo(map);
                    const circleObj = { coord: c.coord, radius: c.radius, id: Date.now() + Math.random(), layer: circle };
                    circleList.push(circleObj);
                    aggiungiVoceListaCircle(circleObj);
                });
            }

            // Labels
            if (data.labels) {
                data.labels.forEach(l => {
                    const labelPopup = L.popup({
                        closeButton: false,
                        autoClose: false,
                        closeOnClick: false
                    })
                        .setLatLng(l.coord)
                        .setContent(l.text)
                        .addTo(map);
                    const labelObj = { coord: l.coord, text: l.text, id: Date.now() + Math.random(), layer: labelPopup };
                    labels.push(labelObj);
                    aggiungiVoceListaLabel(labelObj);
                });
            }

            // Lines
            if (data.lines) {
                data.lines.forEach(latlngsArr => {
                    const latlngs = latlngsArr.map(c => ({ lat: c[0], lng: c[1] }));
                    const line = L.polyline(latlngs, { color: 'blue' }).addTo(map);
                    lines.push(line);
                    // Optionally, you can re-bind popups or eraser handlers here if needed
                });
            }
            
            // Markers (segnaposti)
            if (data.markers) {
                data.markers.forEach(m => {
                    const customIcon = L.icon({
                        iconUrl: m.image,
                        iconSize: [32, 32],
                        iconAnchor: [16, 32],
                    });
                    const marker = L.marker(m.coord, { icon: customIcon }).addTo(map);
                    const segnapostoObj = { coord: m.coord, icon: customIcon, id: Date.now() + Math.random(), layer: marker };
                    segnaposti.push(segnapostoObj);
                    aggiungiVoceListaSegnaposto(segnapostoObj);
                });
            }
        } catch (err) {
            alert("Invalid JSON file.");
        }
    };
    reader.readAsText(file);
});
