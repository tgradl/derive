import leaflet from 'leaflet';
import leafletImage from 'leaflet-image';
import 'leaflet-providers';
import 'leaflet-easybutton';

import {buildSettingsModal, showModal} from  './ui';


// Los Angeles is the center of the universe
const INIT_COORDS = [34.0522, -118.243];


const DEFAULT_OPTIONS = {
    theme: 'CartoDB.DarkMatter',
    lineOptions: {
        color: '#0CB1E8',
        weight: 1,
        opacity: 0.5,
        smoothFactor: 1,
        overrideExisting: true,
        detectColors: true,
    }
};


export default class GpxMap {
    constructor(options) {
        this.options = options || DEFAULT_OPTIONS;
        this.tracks = [];

        this.map = leaflet.map('background-map', {
            center: INIT_COORDS,
            zoom: 10,
            preferCanvas: true,
        });

        leaflet.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-camera fa-lg',
                stateName: 'default',
                title: 'Export as png',
                onClick: (_btn, _map) => {
                    let modal = showModal('exportImage')
                        .afterClose(() => modal.destroy());

                    document.getElementById('render-export').onclick = (e) => {
                        e.preventDefault();

                        let output = document.getElementById('export-output');
                        output.innerHTML = `Rendering <i class="fa fa-cog fa-spin"></i>`;

                        let form = document.getElementById('export-settings').elements;
                        this.screenshot(form.format.value, output);
                    };
                }
            }]
        }).addTo(this.map);

        leaflet.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-sliders fa-lg',
                stateName: 'default',
                title: 'Open settings dialog',
                onClick: (_btn, _map) => {
                    buildSettingsModal(this.tracks, this.options, (opts) => {
                        this.updateOptions(opts);
                    }).show();
                },
            }],
        }).addTo(this.map);

        this.viewAll = leaflet.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-map fa-lg',
                stateName: 'default',
                title: 'Zoom to all tracks',
                onClick: (_btn, map) => {
                    this.center();
                },
            }],
        }).addTo(this.map);

        this.markScrolled = () => {
            this.map.removeEventListener('movestart', this.markScrolled);
            this.scrolled = true;
        };

        this.clearScroll();
        this.viewAll.disable();
        this.switchTheme(this.options.theme);
        this.requestBrowserLocation();
    }

    clearScroll () {
        this.scrolled = false;
        this.map.addEventListener('movestart', this.markScrolled);
    }

    switchTheme(themeName) {
        if (this.mapTiles) {
            this.mapTiles.removeFrom(this.map);
        }

        this.mapTiles = leaflet.tileLayer.provider(themeName);
        this.mapTiles.addTo(this.map, {detectRetina: true});
    }

    updateOptions(opts) {
        if (opts.theme !== this.options.theme) {
            this.switchTheme(opts.theme);
        }

        if (opts.lineOptions.overrideExisting) {
            this.tracks.forEach(t => {
                t.setStyle({
                    color: opts.lineOptions.color,
                    weight: opts.lineOptions.weight,
                    opacity: opts.lineOptions.opacity,
                });

                t.redraw();
            });
        }

        this.options = opts;
    }

    // Try to pull geo location from browser and center the map
    requestBrowserLocation() {
        navigator.geolocation.getCurrentPosition(pos => {
            if (!this.scrolled && this.tracks.length === 0) {
                this.map.panTo([pos.coords.latitude, pos.coords.longitude], {
                    noMoveStart: true,
                    animate: false,
                });
                // noMoveStart doesn't seem to have an effect, see Leaflet
                // issue: https://github.com/Leaflet/Leaflet/issues/5396
                this.clearScroll();
            }
        });
    }

    addTrack(track) {
        this.viewAll.enable();
        let lineOptions = Object.assign({}, this.options.lineOptions);

        if (lineOptions.detectColors) {
            if (/-(Hike|Walk)\.gpx/.test(track.filename)) {
                lineOptions.color = '#ffc0cb';
            } else if (/-Run\.gpx/.test(track.filename)) {
                lineOptions.color = '#ff0000';
            } else if (/-Ride\.gpx/.test(track.filename)) {
                lineOptions.color = '#00ffff';
            }
        }

        let line = leaflet.polyline(track.points, lineOptions);
        line.addTo(this.map);

        this.tracks.push(line);
    }

    // Center the map if the user has not yet manually panned the map
    recenter() {
        if (!this.scrolled) {
            this.center();
        }
    }

    center() {
        // If there are no tracks, then don't try to get the bounds, as there
        // would be an error
        if (this.tracks.length === 0) {
            return;
        }

        this.map.fitBounds((new leaflet.featureGroup(this.tracks)).getBounds(), {
            noMoveStart: true,
            animate: false,
            padding: [50, 20],
        });

        if (!this.scrolled) {
            this.clearScroll();
        }
    }

    screenshot(format, domNode) {
        leafletImage(this.map, (err, canvas) => {
            if (err) {
                return window.alert(err);
            }

            let link = document.createElement('a');

            if (format === 'png') {
                link.download = 'derive-export.png';
                link.innerText = 'Download as PNG';

                canvas.toBlob(blob => {
                    link.href = URL.createObjectURL(blob);
                    domNode.innerText = '';
                    domNode.appendChild(link);
                });
            } else if (format === 'svg') {
                link.innerText = 'Download as SVG';

                const scale = 2;
                const left = this.map.getPixelOrigin().x * scale;
                const top = this.map.getPixelOrigin().y * scale;
                const width = this.map.getSize().x * scale;
                const height = this.map.getSize().y * scale;
                const bounds = leaflet.bounds([left, top], [left+width, top+height]);

                let svg = leaflet.SVG.create('svg');
                let root = leaflet.SVG.create('g');

                svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);

                this.tracks.forEach(track => {
                    let pts = track.getLatLngs().map(ll =>
                            this.map.project(ll)
                                    .multiplyBy(scale*10)
                                    .round()
                                    .divideBy(10)
                    ).reduce((acc,next) => {
                        if (acc.length === 0 ||
                                acc[acc.length-1].x !== next.x ||
                                acc[acc.length-1].y !== next.y) {
                            acc.push(next);
                        }
                        return acc;
                    }, []);
                    
                    if (!pts.some(pt => bounds.contains(pt))) {
                        return;
                    }
                    let path = leaflet.SVG.pointsToPath([pts], false);
                    let el = leaflet.SVG.create('path');

                    el.setAttribute('stroke', track.options.color);
                    el.setAttribute('stroke-opacity', track.options.opacity);
                    el.setAttribute('stroke-width', track.options.weight);
                    el.setAttribute('stroke-linecap', 'round');
                    el.setAttribute('stroke-linejoin', 'round');
                    el.setAttribute('fill', 'none');

                    el.setAttribute('d', path);

                    root.appendChild(el);
                });

                svg.appendChild(root);

                let xml = (new XMLSerializer()).serializeToString(svg);
                link.download = 'derive-export.svg';

                let blob = new Blob([xml], {type: 'application/octet-stream'});
                link.href = URL.createObjectURL(blob);

                domNode.innerText = '';
                domNode.appendChild(link);
            }
        });
    }
}
