<script lang="ts" context="module">
    import {
        getAirportPressureAtLocation,
        isSensorAvailable,
        startListeningForSensor,
        stopListeningForSensor
    } from '@nativescript-community/sensors';
    import { getAltitude } from '@nativescript-community/sensors/sensors';
    import { prompt } from '@nativescript-community/ui-material-dialogs';
    import type { ApplicationEventData } from '@nativescript/core/application';
    import { off as applicationOff, on as applicationOn, resumeEvent, suspendEvent } from '@nativescript/core/application';
    import { onDestroy, onMount } from 'svelte';
    import { GeoHandler, GeoLocation, UserLocationdEventData } from '~/handlers/GeoHandler';
    import { l, lc } from '~/helpers/locale';
    import { getMapContext } from '~/mapModules/MapModule';
    import UserLocationModule from '~/mapModules/UserLocationModule';
    import { onServiceLoaded } from '~/services/BgService.common';
    import { networkService } from '~/services/NetworkService';
    import { packageService } from '~/services/PackageService';
    import mapStore from '~/stores/mapStore';
    import { ApplicationSettings } from '@nativescript/core';

    import { primaryColor } from '~/variables';
</script>

<script lang="ts">
    import { showSnack } from '@nativescript-community/ui-material-snackbar';

    let currentLocation: GeoLocation = null;
    let referencePressure = null;
    let referenceAltitude = null;
    let airportRefName: string = null;
    let userLocationModule: UserLocationModule = null;
    let pressureAltitude: number = null;
    let currentPressure: number = null;
    let listeningForBarometer = false;
    const mapContext = getMapContext();
    export let height: number = 200;
    let geoHandler: GeoHandler;
    onMount(() => {
        const reference = ApplicationSettings.getString('altimeter_reference');
        if (reference) {
            const json = JSON.parse(reference);
            referencePressure = json.pressure;
            referenceAltitude = json.altitude;
            airportRefName = json.name;
        }
        applicationOn(suspendEvent, onAppPause, this);
        applicationOn(resumeEvent, onAppResume, this);
        userLocationModule = mapContext.mapModule('userLocation');
        userLocationModule.on('location', onNewLocation, this);
        onNewLocation({ data: userLocationModule.lastUserLocation } as any);
        onServiceLoaded((handler: GeoHandler) => {
            geoHandler = handler;
        });
    });
    onDestroy(() => {
        applicationOff(suspendEvent, onAppPause, this);
        applicationOff(resumeEvent, onAppResume, this);
        userLocationModule.off('location', onNewLocation, this);
        if (listeningForBarometer) {
            stopBarometerAltitudeUpdate();
        }
    });

    // $: {
    //     if (listeningForBarometer) {
    //         if (!referencePressure) {
    //             shownAltitude = l('no_ref');
    //         }
    //         shownAltitude = pressureAltitude !== null ? pressureAltitude : '-  ';
    //     } else if (pressureAltitude !== null) {
    //         shownAltitude = pressureAltitude;
    //     } else {
    //         shownAltitude = currentLocation && currentLocation.altitude !== undefined ? currentLocation.altitude : '-  ';
    //     }
    // }
    let wasListeningForBarometerBeforePause = false;
    let dontListenForBarometerWhilePaused = true;
    function onAppResume(args: ApplicationEventData) {
        if (wasListeningForBarometerBeforePause) {
            startBarometerAltitudeUpdate();
            wasListeningForBarometerBeforePause = false;
        }
    }
    function onAppPause(args: ApplicationEventData) {
        if (listeningForBarometer) {
            if (dontListenForBarometerWhilePaused) {
                wasListeningForBarometerBeforePause = true;
                stopBarometerAltitudeUpdate();
            }
        }
    }
    async function onNewLocation(e: UserLocationdEventData) {
        currentLocation = e.data;
    }
    function startBarometer() {
        if (listeningForBarometer) {
            startListeningForSensor('barometer', onSensor, 1000);
        }
    }
    function stopBarometer() {
        if (listeningForBarometer) {
            stopListeningForSensor('barometer', onSensor);
        }
    }

    function startBarometerAltitudeUpdate() {
        if (!listeningForBarometer) {
            listeningForBarometer = true;
            startBarometer();
        }
    }
    function stopBarometerAltitudeUpdate() {
        console.log('stopBarometerAltitudeUpdate');
        currentPressure = null;
        if (listeningForBarometer) {
            stopBarometer();
            listeningForBarometer = false;
        }
    }
    function switchBarometer() {
        if (listeningForBarometer) {
            stopBarometerAltitudeUpdate();
        } else {
            startBarometerAltitudeUpdate();
        }
    }
    function resetReference() {
        referenceAltitude = null;
        referencePressure = null;
        airportRefName = null;
        ApplicationSettings.remove('altimeter_reference');
    }
    async function getNearestAirportPressure() {
        referencePressure = null;
        airportRefName = null;
        if (!networkService.connected || packageService.hasElevation()) {
            return;
        }
        return geoHandler.enableLocation().then(() => {
            geoHandler
                .getLocation({ maximumAge: 120000 })
                .then((r) => getAirportPressureAtLocation(gVars.AVWX_API_KEY, r.lat, r.lon))
                .then((r) => {
                    referenceAltitude = r.elevation;
                    referencePressure = r.pressure;
                    airportRefName = r.name;
                    ApplicationSettings.setString(
                        'altimeter_reference',
                        JSON.stringify({
                            altitude: r.elevation,
                            pressure: r.pressure,
                            name: r.name
                        })
                    );
                    showSnack({ message: `found nearest airport pressure ${r.name} with pressure:${r.pressure} hPa` });
                })
                .catch((err) => {
                    alert(`could not find nearest airport pressure: ${err}`);
                });
        });
    }
    async function onSensor(data, sensor: string) {
        switch (sensor) {
            case 'barometer':
                currentPressure = data.pressure.toFixed(2);
                if (referencePressure != null) {
                    pressureAltitude = Math.round(getAltitude(data.pressure, referencePressure));
                    stopBarometer();
                    if (listeningForBarometer) {
                        setTimeout(() => {
                            startBarometer();
                        }, 5000);
                    }
                } else if (
                    currentLocation &&
                    Date.now() - currentLocation.timestamp < 60 * 1000 * 10 &&
                    currentLocation.altitude
                ) {
                    stopBarometer();
                    let assumedTemp = 15;
                    const result = await prompt({
                        title: lc('current_temperature'),
                        // message: this.$tc('change_glasses_name'),
                        okButtonText: l('set'),
                        cancelButtonText: l('cancel'),
                        autoFocus: true,
                        defaultText: assumedTemp + ''
                    });
                    if (result && !!result.result && result.text.length > 0) {
                        assumedTemp = parseFloat(result.text);
                    }
                    referenceAltitude = currentLocation.altitude;
                    referencePressure =
                        data.pressure *
                        Math.pow(1 - (0.0065 * referenceAltitude) / (assumedTemp + 0.0065 * referenceAltitude + 273.15), -5.257);
                    ApplicationSettings.setString(
                        'altimeter_reference',
                        JSON.stringify({
                            altitude: referenceAltitude,
                            pressure: referencePressure
                        })
                    );
                    if (listeningForBarometer) {
                        setTimeout(() => {
                            startBarometer();
                        }, 5000);
                    }
                }
                break;
        }
    }
    function askUserLocation() {
        return userLocationModule.askUserLocation();
    }
</script>

<gridLayout {height}>
    <canvaslabel padding="16">
        <cspan text={currentPressure} fontSize="16" textAlignment="right" />
        <cgroup
            visibility={!!referencePressure ? 'visible' : 'hidden'}
            verticalAlignment="bottom"
            fontSize="14"
            textAlignment="right"
        >
            <cspan text={referencePressure && referencePressure.toFixed(2)} fontSize="14" />
            <cspan text={'\n' + (referenceAltitude && Math.round(referenceAltitude) + 'm')} />
        </cgroup>
        <cgroup horizontalAlignment="center" textAlignment="center" verticalAlignment="center">
            <cspan text={pressureAltitude || '-'} fontSize="30" />
            <cspan text=" m" fontSize="20" />
        </cgroup>
        <cspan
            visibility={!!currentLocation ? 'visible' : 'hidden'}
            text={!!currentLocation && currentLocation.altitude + 'm'}
            fontSize="14"
            verticalAlignment="bottom"
            textAlignment="left"
        />
    </canvaslabel>

    <stacklayout orientation="horizontal" horizontalAlignment="left" verticalAlignment="top">
        <button
            variant="text"
            class="icon-btn"
            text="mdi-gauge"
            on:tap={switchBarometer}
            color={listeningForBarometer ? primaryColor : undefined}
        />
        <button variant="text" class="icon-btn" text="mdi-airplane" on:tap={getNearestAirportPressure}/>
        <button variant="text" class="icon-btn" text="mdi-refresh" on:tap={resetReference} />
        <button
            variant="text"
            class="icon-btn"
            text="mdi-crosshairs-gps"
            on:tap={askUserLocation}
            color={$mapStore.watchingLocation || $mapStore.queryingLocation ? primaryColor : undefined}
        />
    </stacklayout>
</gridLayout>
