import Observable from '@nativescript-community/observable';
import { Layer } from '@nativescript-community/ui-carto/layers';
import { RasterTileClickInfo } from '@nativescript-community/ui-carto/layers/raster';
import { VectorElementEventData, VectorTileEventData } from '@nativescript-community/ui-carto/layers/vector';
import { Projection } from '@nativescript-community/ui-carto/projections';
import { CartoMap } from '@nativescript-community/ui-carto/ui';
import { MBVectorTileDecoder } from '@nativescript-community/ui-carto/vectortiles';
import { Drawer } from '@nativescript-community/ui-drawer';
import { Page } from '@nativescript/core';
import { NativeViewElementNode } from 'svelte-native/dom';
import { GeoHandler } from '~/handlers/GeoHandler';
import { IItem } from '~/models/Item';
import CustomLayersModule from './CustomLayersModule';
import DirectionsPanel from './DirectionsPanel.svelte';
import ItemsModule from './ItemsModule';
import UserLocationModule from './UserLocationModule';

export interface IMapModule {
    onMapReady(mapView: CartoMap<LatLonKeys>);
    onMapDestroyed();
    onServiceLoaded?(geoHandler: GeoHandler);
    onServiceUnloaded?(geoHandler: GeoHandler);
    onMapMove?(e);
    onMapClicked?(e);
    onVectorTileClicked?(data: VectorTileEventData<LatLonKeys>);
    onVectorElementClicked?(data: VectorElementEventData<LatLonKeys>);
    onSelectedItem?(item: IItem, oldItem: IItem);
}
export type LayerType = 'map' | 'customLayers' | 'hillshade' | 'selection' | 'items' | 'directions' | 'userLocation' | 'search';

export interface MapContext {
    drawer: Drawer;
    mapModules: MapModules;
    toggleMenu(side: string);
    showOptions();
    mapModule<T extends keyof MapModules>(id: T): MapModules[T];
    onMapReady(callback: (map: CartoMap<LatLonKeys>) => void);
    onMapMove(callback: (map: CartoMap<LatLonKeys>) => void);
    onMapStable(callback: (map: CartoMap<LatLonKeys>) => void);
    onMapIdle(callback: (map: CartoMap<LatLonKeys>) => void);
    onMapClicked(callback: (map: CartoMap<LatLonKeys>) => void);
    onVectorElementClicked(callback: (data: VectorElementEventData<LatLonKeys>) => void);
    onVectorTileClicked(callback: (data: VectorTileEventData<LatLonKeys>) => void);
    getMainPage: () => NativeViewElementNode<Page>;
    getMap: () => CartoMap<LatLonKeys>;
    getProjection: () => Projection;
    setBottomSheetStepIndex: (value: number) => void;
    selectItem: (args: { item: IItem; showButtons?: boolean; isFeatureInteresting: boolean; peek?: boolean; setSelected?: boolean; minZoom?: number; zoom?: number; zoomDuration?: number }) => void;
    zoomToItem: (args: { item: IItem; zoom?: number; minZoom?: number }) => void;
    unselectItem: () => void;
    getCurrentLanguage: () => string;
    getSelectedItem: () => IItem;
    addLayer: (layer: Layer<any, any>, layerId: LayerType) => number;
    insertLayer: (layer: Layer<any, any>, layerId: LayerType, index: number) => void;
    removeLayer: (layer: Layer<any, any>, layerId: LayerType) => void;
    moveLayer: (layer: Layer<any, any>, newIndex: number) => void;
    getLayerIndex: (layer: Layer<any, any>) => number;
    replaceLayer: (oldLayer: Layer<any, any>, layer: Layer<any, any>) => number;
    getLayerTypeFirstIndex: (layerId: LayerType) => number;
    vectorElementClicked: (data: VectorElementEventData<LatLonKeys>) => boolean;
    vectorTileClicked: (data: VectorTileEventData<LatLonKeys>) => boolean;
    rasterTileClicked: (data: RasterTileClickInfo<LatLonKeys>) => boolean;
    getVectorTileDecoder(): MBVectorTileDecoder;
    runOnModules(functionName: string, ...args);
}

export interface MapModules {
    // mapScrollingWidgets: MapScrollingWidgets;
    // search: Search;
    customLayers: CustomLayersModule;
    directionsPanel: DirectionsPanel;
    userLocation: UserLocationModule;
    items: ItemsModule;
    // rightMenu: MapRightMenu;
    // bottomSheet: BottomSheetInner;
}

const listeners = {
    onMapReady: [],
    onMapMove: [],
    onMapStable: [],
    onMapIdle: [],
    onMapClicked: [],
    onVectorElementClicked: [],
    onRasterTileClicked: []
};
export let drawer: Drawer;

const mapContext: MapContext = {
    mapModules: {},
    onMapReady(callback: (map: CartoMap<LatLonKeys>) => void) {
        listeners.onMapReady.push(callback);
    },
    onMapMove(callback: (map: CartoMap<LatLonKeys>) => void) {
        listeners.onMapMove.push(callback);
    },
    onMapStable(callback: (map: CartoMap<LatLonKeys>) => void) {
        listeners.onMapStable.push(callback);
    },
    onMapIdle(callback: (map: CartoMap<LatLonKeys>) => void) {
        listeners.onMapIdle.push(callback);
    },
    onMapClicked(callback: (map: CartoMap<LatLonKeys>) => void) {
        listeners.onMapClicked.push(callback);
    },
    onVectorElementClicked(callback: (data: VectorElementEventData<LatLonKeys>) => void) {
        listeners.onVectorElementClicked.push(callback);
    },
    onRasterTileClicked(callback: (data: RasterTileClickInfo<LatLonKeys>) => void) {
        listeners.onRasterTileClicked.push(callback);
    },
    mapModule<T extends keyof MapModules>(id: T) {
        return mapContext.mapModules && mapContext.mapModules[id];
    },
    runOnModules(functionName: string, ...args) {
        let result = Object.values(mapContext.mapModules).some((m) => {
            if (m && m[functionName]) {
                const result = (m[functionName] as Function).call(m, ...args);
                if (result) {
                    return result;
                }
                return false;
            }
        });
        if (!result && listeners[functionName] && listeners[functionName].length > 0) {
            result = listeners[functionName].some((l) => l(...args));
        }
        return result;
    }
} as any;

export function setMapContext(ctx) {
    Object.assign(mapContext, ctx);
}

export function getMapContext() {
    return mapContext;
}

export default abstract class MapModule extends Observable implements IMapModule {
    mapView: CartoMap<LatLonKeys>;
    onMapReady(mapView: CartoMap<LatLonKeys>) {
        this.mapView = mapView;
    }
    onMapDestroyed() {
        this.mapView = null;
    }
    log(...args) {
        console.log(`[${this.constructor.name}]`, ...args);
    }
    onServiceLoaded?(geoHandler: GeoHandler);
    onServiceUnloaded?(geoHandler: GeoHandler);
    onMapMove?(e);
    onMapClicked?(e);
    onVectorTileClicked?(data: VectorTileEventData<LatLonKeys>);
    onVectorElementClicked?(data: VectorElementEventData<LatLonKeys>);
    onSelectedItem?(item: IItem, oldItem: IItem);
}
