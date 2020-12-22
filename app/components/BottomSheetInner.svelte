<script lang="ts">
    import { Align, Canvas, Paint } from '@nativescript-community/ui-canvas';
    import { CartoMap } from '@nativescript-community/ui-carto/ui';
    import { LineChart } from '@nativescript-community/ui-chart/charts';
    import { HighlightEventData } from '@nativescript-community/ui-chart/charts/Chart';
    import { XAxisPosition } from '@nativescript-community/ui-chart/components/XAxis';
    import { Entry } from '@nativescript-community/ui-chart/data/Entry';
    import { LineData } from '@nativescript-community/ui-chart/data/LineData';
    import { LineDataSet } from '@nativescript-community/ui-chart/data/LineDataSet';
    import { Highlight } from '@nativescript-community/ui-chart/highlight/Highlight';
    import { ShareFile } from '@nativescript-community/ui-share-file';
    import { Application, GridLayout, knownFolders } from '@nativescript/core';
    import { openUrl } from '@nativescript/core/utils';
    import { onDestroy, onMount } from 'svelte';
    import { NativeViewElementNode } from 'svelte-native/dom';
    import { convertValueToUnit } from '~/helpers/formatter';
    import { getMapContext } from '~/mapModules/MapModule';
    import { IItem, IItem as Item } from '~/models/Item';
    import { packageService } from '~/services/PackageService';
    import { omit } from '~/utils/utils';
    import { showError } from '~/utils/error';
    import { screenHeightDips, statusBarHeight, textColor } from '~/variables';
    import BottomSheetInfoView from './BottomSheetInfoView.svelte';
    import BottomSheetRouteInfoView from './BottomSheetRouteInfoView.svelte';
    import { formatter } from '~/mapModules/ItemFormatter';
    import { writable } from 'svelte/store';
    import { RouteInstruction } from '~/models/Route';

    export const LISTVIEW_HEIGHT = 200;
    export const PROFILE_HEIGHT = 150;
    export const WEB_HEIGHT = 400;

    const mapContext = getMapContext();

    export let item: Item;

    let profileHeight = PROFILE_HEIGHT;
    let graphAvailable = false;

    onMount(() => {
        updateSteps();
    });

    mapContext.onMapReady((mapView: CartoMap<LatLonKeys>) => {
        // updateSteps();
        mapContext.mapModule('userLocation').on('location', onNewLocation, this);
    });
    onDestroy(() => {
        mapContext.mapModule('userLocation').on('location', onNewLocation, this);
    });
    let chart: NativeViewElementNode<LineChart>;
    let routeView: BottomSheetRouteInfoView;
    let infoView: BottomSheetInfoView;
    let webViewSrc: string = null;
    $: {
        // if (listViewAvailable && item?.properties) {
        if (item && item.properties) {
            const props = item.properties;
            let name = props.name;
            if (props.wikipedia) {
                name = props.wikipedia.split(':')[1];
            }
            if (item.address) {
                name += ' ' + item.address.county;
            }
            const url = `https://duckduckgo.com/?kae=d&ks=s&ko=-2&kaj=m&k1=-1&q=${encodeURIComponent(name)
                .toLowerCase()
                .replace('/s+/g', '+')}`;
            // console.log('webViewSrc', url);
            webViewSrc = url;
        } else {
            webViewSrc = null;
        }
    }
    let rows = '70,50,auto,auto';
    let showListView = false;
    $: showListView = listViewAvailable && listViewVisible;

    let itemRouteNoProfile = false;
    $: itemRouteNoProfile = item && !!item.route && (!item.route.profile || !item.route.profile.max);

    let itemIsRoute = false;
    $: itemIsRoute = item && !!item.route;

    function updateGraphAvailable(item) {
        graphAvailable = itemIsRoute && !!item.route.profile && !!item.route.profile.data && item.route.profile.data.length > 0;
    }
    $: {
        updateGraphAvailable(item);
        updateSteps();
        if (graphAvailable) {
            updateChartData();
        }
    }

    function onNewLocation(e: any) {
        const index = routeView.onNewLocation(e);
        if (index !== -1 && graphAvailable) {
            const profile = item.route.profile;
            const profileData = profile?.data;
            if (profileData) {
                const dataSet = chart.nativeView.getData().getDataSetByIndex(0);
                dataSet.setIgnoreFiltered(true);
                const item = profileData[index];
                dataSet.setIgnoreFiltered(false);
                // console.log('highlight item', item);
                chart.nativeView.highlightValues([
                    {
                        dataSetIndex: 0,
                        x: index,
                        entry: item
                    } as any
                ]);
            }
        }
    }
    function onChartHighlight(event: HighlightEventData) {
        const x = event.highlight.entryIndex;
        const positions = item.route.positions;
        const position = positions.getPos(Math.max(0, Math.min(x, positions.size() - 1)));
        if (position) {
            mapContext.selectItem({ item: { position }, isFeatureInteresting: true, setSelected: false, peek: false });
        }
    }
    function searchItemWeb() {
        if (global.isAndroid) {
            const query = formatter.getItemName(item);
            if (global.isAndroid) {
                const intent = new android.content.Intent(android.content.Intent.ACTION_WEB_SEARCH);
                intent.putExtra(android.app.SearchManager.QUERY, query); // query contains search string
                (Application.android.foregroundActivity as android.app.Activity).startActivity(intent);
            }
        }
    }
    function openWebView() {
        openUrl(webViewSrc);
    }
    let webViewHeight = 0;
    let listViewAvailable = false;
    let listViewVisible = false;
    function toggleWebView() {
        // stepToScrollTo = !listViewAvailable ? steps.length : -1;
        listViewAvailable = !listViewAvailable;
    }
    export let steps;
    // $: console.log('updateSteps changed', steps);

    function updateSteps() {
        let total = 70;
        const result = [0, total];
        total += 50;
        result.push(total);
        if (graphAvailable) {
            total += PROFILE_HEIGHT;
            result.push(total);
        }
        if (listViewAvailable) {
            total += WEB_HEIGHT;
            result.push(total);
            const delta = Math.floor(screenHeightDips - statusBarHeight - total);
            webViewHeight = WEB_HEIGHT + delta;
            total += delta;
            result.push(total);
        }
        steps = result;
    }

    let updatingItem = false;
    async function getProfile() {
        updatingItem = true;
        const profile = await packageService.getElevationProfile(item);
        // item.route.profile = profile;
        item.id !== undefined ? await updateItem(item, { route: { profile } } as any) : await saveItem(false);
        updateGraphAvailable(item);
        updateSteps();
        if (graphAvailable) {
            updateChartData();
        }
        mapContext.setBottomSheetStepIndex(3);
        updatingItem = false;
    }
    function saveItem(peek = true) {
        mapContext
            .mapModule('items')
            .saveItem(mapContext.getSelecetedItem())
            .then((item) => {
                mapContext.selectItem({ item, isFeatureInteresting: true, peek });
            })
            .catch((err) => {
                showError(err);
            });
    }
    async function updateItem(item: IItem, data: Partial<IItem>, peek = true) {
        mapContext
            .mapModule('items')
            .updateItem(item, data)
            .then((item) => {
                mapContext.selectItem({ item, isFeatureInteresting: true, peek });
            })
            .catch((err) => {
                showError(err);
            });
    }
    function deleteItem() {
        mapContext.mapModule('items').deleteItem(mapContext.getSelecetedItem());
    }
    function shareItem() {
        const itemToShare = omit(item, 'vectorElement');
        shareFile(JSON.stringify(itemToShare), 'sharedItem.json');
    }
    async function shareFile(content: string, fileName: string) {
        const file = knownFolders.temp().getFile(fileName);
        // iOS: using writeText was not adding the file. Surely because it was too soon or something
        // doing it sync works better but still needs a timeout
        // showLoading('loading');
        await file.writeText(content);
        const shareFile = new ShareFile();
        await shareFile.open({
            path: file.path,
            title: fileName,
            options: true, // optional iOS
            animated: true // optional iOS
        });
    }
    function getRouteInstructionTitle(item: RouteInstruction) {
        return item.inst;
    }
    function getRouteInstructionSubtitle(item: RouteInstruction) {
        return item.name;
    }
    let chartInitialized = false;
    function updateChartData() {
        const chartView = chart.nativeView;
        const sets = [];
        const profile = item.route.profile;
        const profileData = profile?.data;
        if (profileData) {
            if (!chartInitialized) {
                chartInitialized = true;
                chartView.setHighlightPerDragEnabled(true);
                chartView.setHighlightPerTapEnabled(true);
                // chart.setScaleXEnabled(true);
                // chart.setDragEnabled(true);
                chartView.getAxisRight().setEnabled(false);
                chartView.getLegend().setEnabled(false);
                chartView.setDrawHighlight(false);
                const leftAxis = chartView.getAxisLeft();
                leftAxis.setTextColor(textColor);
                leftAxis.setLabelCount(3);

                const xAxis = chartView.getXAxis();
                xAxis.setPosition(XAxisPosition.BOTTOM);
                xAxis.setTextColor(textColor);
                xAxis.setValueFormatter({
                    getAxisLabel: (value, axis) => convertValueToUnit(value, 'km').join(' ')
                });

                chartView.setMaxVisibleValueCount(300);
                chartView.setMarker({
                    paint: new Paint(),
                    refreshContent(e: Entry, highlight: Highlight) {
                        this.entry = e;
                    },
                    draw(canvas: Canvas, posX: any, posY: any) {
                        const canvasHeight = canvas.getHeight();
                        const paint = this.paint as Paint;
                        paint.setColor('#FFBB73');
                        paint.setAntiAlias(true);
                        paint.setTextAlign(Align.CENTER);
                        paint.setStrokeWidth(1);
                        paint.setTextSize(10);
                        canvas.save();
                        canvas.translate(posX, posY);
                        canvas.drawLine(-5, 0, 5, 0, paint);
                        canvas.drawLine(0, -5, 0, 5, paint);
                        if (posY > canvasHeight - 20) {
                            canvas.translate(0, -30);
                        } else {
                            canvas.translate(0, 10);
                        }
                        canvas.drawText(this.entry.a.toFixed(), 0, 5, paint);
                        canvas.restore();
                    }
                } as any);
            } else {
                chartView.highlightValues(null);
                chartView.resetZoom();
            }
            const chartData = chartView.getData();
            if (!chartData) {
                const set = new LineDataSet(profileData, 'a', 'd', 'avg');
                set.setDrawValues(true);
                set.setValueTextColor(textColor);
                set.setValueTextSize(10);
                set.setMaxFilterNumber(200);
                set.setUseColorsForFill(true);
                set.setFillFormatter({
                    getFillLinePosition(dataSet: LineDataSet, dataProvider) {
                        return dataProvider.getYChartMin();
                    }
                });
                set.setValueFormatter({
                    getFormattedValue(value: number, entry: Entry, index, count, dataSetIndex: any, viewPortHandler: any) {
                        if (index === 0 || index === count - 1 || value === profile.max[1]) {
                            return value.toFixed();
                        }
                    }
                } as any);
                set.setDrawFilled(true);
                if (profile.colors && profile.colors.length > 0) {
                    set.setLineWidth(2);
                    set.setColors(profile.colors);
                } else {
                    set.setColor('#60B3FC');
                }
                // set.setMode(Mode.CUBIC_BEZIER);
                set.setFillColor('#8060B3FC');
                sets.push(set);
                const lineData = new LineData(sets);
                chartView.setData(lineData);
            } else {
                chartView.highlightValues(null);
                const dataSet = chartData.getDataSetByIndex(0);
                dataSet.setValues(profileData);
                chartView.getData().notifyDataChanged();
                chartView.notifyDataSetChanged();
            }
        }
    }
    function routeInstructions() {
        if (listViewAvailable) {
            return item.route.instructions;
        }
        return [];
    }
    function onInstructionTap(instruction: RouteInstruction) {
        // console.log('onInstructionTap', instruction);
        // mapComp.selectItem({
        //     item: { position: instruction.position },
        //     isFeatureInteresting: true,
        //     setSelected: false,
        //     peek: false
        // });
        // if (graphAvailable) {
        //     const dataSet = chart.getData().getDataSetByIndex(0);
        //     dataSet.setIgnoreFiltered(true);
        //     const item = dataSet.getEntryForIndex(instruction.pointIndex);
        //     dataSet.setIgnoreFiltered(false);
        //     // console.log('highlight item', item);
        //     chart.highlightValues([
        //         {
        //             dataSetIndex: 0,
        //             x: item.x,
        //             entry: item
        //         } as Highlight
        //     ]);
        // }
    }
    let loaded = false;
    let loadedListeners = [];
    export async function loadView() {
        if (!loaded) {
            await new Promise((resolve) => {
                loadedListeners.push(resolve);
                loaded = true;
            });
        }
    }
    $: {
        if (infoView) {
            loadedListeners.forEach((l) => l());
        }
    }
</script>

<gridlayout
    {...$$restProps}
    id="bottomsheetinner"
    width="100%"
    rows={`70,50,${profileHeight},auto`}
    backgroundColor="#aa000000"
    on:tap={() => {}}>
    {#if loaded}
        <BottomSheetInfoView
            bind:this={infoView}
            row="0"
            visibility={itemIsRoute ? 'collapsed' : 'visible'}
            item={itemIsRoute ? null : item} />
        <BottomSheetRouteInfoView
            bind:this={routeView}
            row="0"
            visibility={itemIsRoute ? 'visible' : 'collapsed'}
            routeItem={itemIsRoute ? item : null} />

        <mdactivityindicator
            visibility={updatingItem ? 'visible' : 'collapsed'}
            row="0"
            horizontalAligment="right"
            busy={true}
            width={20}
            height={20} />

        <stacklayout
            row="1"
            orientation="horizontal"
            width="100%"
            borderTopWidth="1"
            borderBottomWidth="1"
            borderColor="#44ffffff">
            <button
                variant="text"
                fontSize="10"
                on:tap={searchItemWeb}
                text="search"
                visibility={item && !itemIsRoute && !item.id ? 'visible' : 'collapsed'} />
            <button
                variant="text"
                fontSize="10"
                on:tap={getProfile}
                text="profile"
                visibility={itemIsRoute ? 'visible' : 'collapsed'} />
            <!-- <button variant="text" fontSize="10" on:tap={openWebView} text="web" /> -->
            <button
                variant="text"
                fontSize="10"
                on:tap={saveItem}
                text="save item"
                visibility={item && !item.id ? 'visible' : 'collapsed'} />
            <button
                variant="text"
                fontSize="10"
                on:tap={deleteItem}
                text="delete item"
                visibility={item && item.id ? 'visible' : 'collapsed'}
                color="red" />
            <button
                variant="text"
                fontSize="10"
                on:tap={shareItem}
                text="share item"
                visibility={item && item.id ? 'visible' : 'collapsed'} />
        </stacklayout>
        <linechart
            bind:this={chart}
            row="2"
            height={profileHeight}
            visibility={graphAvailable ? 'visible' : 'hidden'}
            on:highlight={onChartHighlight} />
        <!-- <AWebView
            row="3"
            height={webViewHeight}
            displayZoomControls="false"
            bind:this="listView"
            visibility={listViewVisible ? 'visible' : 'collapsed'}
            @scroll="onListViewScroll"
            isScrollEnabled={scrollEnabled}
            src={webViewSrc}
        /> -->
        <!-- <CollectionView id="bottomsheetListView" row="3" bind:this="listView" rowHeight="40" items="routeInstructions" :visibility="showListView ? 'visible' : 'hidden'" isBounceEnabled="false" @scroll="onListViewScroll" :isScrollEnabled={scrollEnabled}>
            <v-template>
                <GridLayout columns="30,*" rows="*,auto,auto,*" rippleColor="white"  @tap="onInstructionTap(item)">
                    <Label col="0" rowSpan="4" text="getRouteInstructionIcon(item) |fonticon" class="osm" color="white" fontSize="20" verticalAlignment="center" textAlignment={center} />
                    <Label col="1" row="1" text="getRouteInstructionTitle(item)" color="white" fontSize="13" fontWeight={bold} textWrap={true} />
                </GridLayout>
            </v-template>
        </CollectionView> -->
    {/if}
</gridlayout>