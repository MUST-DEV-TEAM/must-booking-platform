'use client';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

/** Where the map opens when no pin is set yet: Albania. */
const FALLBACK_CENTER: [number, number] = [41.15, 20.17];

// A drawn pin instead of Leaflet's image icons, which bundlers do not copy.
const pin = L.divIcon({
  className: '',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 30 12 30s12-9.6 12-18.3C24 5.2 18.6 0 12 0z" fill="currentColor"/><circle cx="12" cy="11.5" r="4.5" fill="white"/></svg>`,
  iconSize: [32, 40],
  iconAnchor: [16, 40],
});

function Recentre({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 16));
  }, [map, position]);
  return null;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onPlace(event.latlng.lat, event.latlng.lng) });
  return null;
}

/**
 * An OpenStreetMap map with one draggable pin (no API key). Clicking the map also moves the pin.
 * Shown only in the browser; `LocationPin` loads it.
 */
export default function LocationPinMap({
  position,
  disabled,
  label,
  onChange,
}: {
  position: [number, number] | null;
  disabled?: boolean;
  /** A name shown above the pin, for example the hotel name. */
  label?: string;
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <div className="relative">
      <MapContainer
        center={position ?? FALLBACK_CENTER}
        zoom={position ? 16 : 7}
        scrollWheelZoom={false}
        className="h-72 w-full rounded-md border text-destructive"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recentre position={position} />
        {disabled ? null : <ClickToPlace onPlace={onChange} />}
        {position ? (
          <Marker
            position={position}
            icon={pin}
            draggable={!disabled}
            eventHandlers={{
              dragend: (event) => {
                const point = (event.target as L.Marker).getLatLng();
                onChange(point.lat, point.lng);
              },
            }}
          >
            {label ? (
              <Tooltip permanent direction="top" offset={[0, -36]} opacity={1}>
                {label}
              </Tooltip>
            ) : null}
          </Marker>
        ) : null}
      </MapContainer>
      {disabled ? null : (
        <span className="pointer-events-none absolute right-2 top-2 z-[1000] rounded-md bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-xs">
          Drag the pin to the entrance
        </span>
      )}
    </div>
  );
}
