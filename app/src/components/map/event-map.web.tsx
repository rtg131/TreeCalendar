import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { glyphSvg } from "@/components/event-type-icon";
import { EVENT_TYPE_META, type Palette } from "@/constants/theme";
import { CLUSTER_PX, clusterGroups, nextInGroup, PIN_SIZE, SELECTED_PIN_SIZE, type Cluster } from "./model";
import type { EventMapProps, MapMarker } from "./types";

const TIP = Math.SQRT1_2;
const shadow = (selected: boolean, ink: string) => (selected ? `0 0 0 3px ${ink}, 0 6px 14px rgba(0,0,0,.35)` : "0 2px 6px rgba(0,0,0,.3)");

function pinIcon(cluster: Cluster<MapMarker>, selected: boolean, palette: Palette) {
  const button = document.createElement("button");
  button.type = "button";
  const count = cluster.ids.length;
  const types = [...new Set(cluster.groups.flatMap((g) => g.eventTypes.map((t) => EVENT_TYPE_META[t].label)))].join(", ");
  button.setAttribute("aria-label", `${count} event${count === 1 ? "" : "s"}: ${types}${cluster.saved ? ", includes saved" : ""}${selected ? ", selected" : ""}`);
  const savedDot = cluster.saved ? `<span style="position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:50%;background:${palette.gold};border:2px solid #fff;box-sizing:border-box"></span>` : "";
  const reset = "padding:0;margin:0;border:0;background:none;cursor:pointer;position:relative;display:block;";
  if (cluster.groups.length > 1) {
    const size = (selected ? SELECTED_PIN_SIZE : PIN_SIZE) + 4;
    button.style.cssText = `${reset}width:${size}px;height:${size}px`;
    button.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:${palette.brand};border:3px solid #fff;box-sizing:border-box;box-shadow:${shadow(selected, palette.ink)};color:#fff;font:600 14px/1 system-ui,-apple-system,sans-serif">${count}</span>${savedDot}`;
    return L.divIcon({ html: button, className: "scout-event-pin", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  const size = selected ? SELECTED_PIN_SIZE : PIN_SIZE;
  const height = Math.ceil(size / 2 + size * TIP);
  const [eventType] = cluster.groups[0].eventTypes;
  const badge = count > 1 ? `<span style="position:absolute;top:-6px;right:-8px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:${palette.ink};color:${palette.bg};border:2px solid #fff;box-sizing:border-box;font:600 11px/14px system-ui,-apple-system,sans-serif;text-align:center">${count}</span>` : "";
  button.style.cssText = `${reset}width:${size}px;height:${height}px`;
  button.innerHTML = `<span style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${EVENT_TYPE_META[eventType].color};border:2px solid #fff;box-sizing:border-box;box-shadow:${shadow(selected, palette.ink)}"></span><span style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${glyphSvg(eventType, Math.round(size * 0.48), "#fff")}</span>${badge}${savedDot}`;
  return L.divIcon({ html: button, className: "scout-event-pin", iconSize: [size, height], iconAnchor: [size / 2, height] });
}

export default function EventMap({ center, radiusKm, recenter, markers, selectedId, onSelect, palette }: EventMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);
  const [zoom, setZoom] = useState(10);
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { scrollWheelZoom: false });
    map.current = instance;
    layer.current = L.layerGroup().addTo(instance);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19, keepBuffer: 0, updateWhenIdle: true,
    }).addTo(instance);
    tiles.on("tileerror", () => setTileError(true));
    instance.on("zoomend", () => setZoom(instance.getZoom()));
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; layer.current = null; };
  }, []);
  useEffect(() => {
    map.current?.fitBounds(L.latLng(center.lat, center.lng).toBounds(radiusKm * 2000), { animate: false });
    if (map.current) setZoom(map.current.getZoom());
  }, [center.lat, center.lng, radiusKm, recenter]);
  const clusters = useMemo(() => clusterGroups(markers, (CLUSTER_PX * 360) / (256 * 2 ** zoom)), [markers, zoom]);
  useEffect(() => {
    layer.current?.clearLayers();
    for (const cluster of clusters) {
      const selected = cluster.ids.includes(selectedId ?? "");
      const { south, west, north, east } = cluster.bounds;
      const spread = cluster.groups.length > 1;
      const marker = L.marker([cluster.lat, cluster.lng], { icon: pinIcon(cluster, selected, palette), keyboard: false, zIndexOffset: selected ? 1000 : spread ? 600 : cluster.saved ? 500 : 0 });
      marker.on("click", () => {
        if (spread) map.current?.flyToBounds([[south, west], [north, east]], { padding: [56, 56], maxZoom: 16, duration: 0.4 });
        else onSelect(nextInGroup(cluster.ids, selectedId));
      });
      marker.addTo(layer.current!);
    }
  }, [clusters, selectedId, onSelect, palette]);
  return <div style={{ flex: 1, position: "relative", minHeight: 180, isolation: "isolate" }}>
    <div ref={element} aria-label="Interactive event map" style={{ height: "100%", width: "100%", minHeight: 180 }} />
    {tileError && <div role="status" style={{ position: "absolute", top: 10, left: 50, right: 10, zIndex: 1000, padding: 8, color: palette.ink, background: palette.surface }}>Map tiles unavailable. Use the event selector below.</div>}
  </div>;
}
