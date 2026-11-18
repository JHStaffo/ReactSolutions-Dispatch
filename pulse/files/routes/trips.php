<?php

use App\Trips\Http\Controllers\BoardController;
use App\Trips\Http\Controllers\CrewController;
use App\Trips\Http\Controllers\FacilityController;
use App\Trips\Http\Controllers\GpsIngestController;
use App\Trips\Http\Controllers\PatientController;
use App\Trips\Http\Controllers\ReportController;
use App\Trips\Http\Controllers\SettingsController;
use App\Trips\Http\Controllers\TripController;
use Illuminate\Support\Facades\Route;

// Truck GPS units post here with the key from Trip Settings (no sign-in).
Route::post('/api/trips/gps', GpsIngestController::class)->middleware(['api', 'throttle:600,1'])->name('trips.gps.ingest');

// Dispatch > Trip Board, Patients, Facilities, Map, My Trips, Trip Reports and Trip Settings.
// Pages that show patients sign out after Trip Settings' idle minutes (TripsIdle).
Route::middleware(['web', 'auth', 'trips.idle'])->prefix('trips')->name('trips')->group(function () {
    Route::middleware('permission:trips_view,trips_dispatch,trips_supervise')->controller(BoardController::class)->group(function () {
        Route::get('/', 'index');
        Route::get('/data', 'data')->name('.data');
        Route::get('/changes', 'changes')->name('.changes');
        Route::get('/facilities.json', 'facilities')->name('.facilities.json');
        Route::get('/gps', 'gps')->name('.gps');
        Route::get('/map', fn () => view('trips.map', ['title' => 'Trip Map', 'constants' => BoardController::constants()]))->name('.map');
    });

    Route::middleware('permission:trips_dispatch')->group(function () {
        Route::controller(TripController::class)->group(function () {
            Route::post('/book', 'store')->name('.store');
            Route::get('/{trip}', 'show')->whereNumber('trip')->name('.show');
            Route::put('/{trip}', 'update')->whereNumber('trip')->name('.update');
            Route::post('/{trip}/assign', 'assign')->whereNumber('trip')->name('.assign');
            Route::post('/{trip}/unassign', 'unassign')->whereNumber('trip')->name('.unassign');
            Route::post('/{trip}/status', 'status')->whereNumber('trip')->name('.status');
            Route::get('/{trip}/suggestions', 'suggestions')->whereNumber('trip')->name('.suggestions');
        });
        Route::prefix('patients')->name('.patients')->controller(PatientController::class)->group(function () {
            Route::get('/', 'index');
            Route::post('/search', 'search')->name('.search');
            Route::post('/lookup', 'lookup')->name('.lookup');
            Route::get('/new', 'create')->name('.create');
            Route::post('/', 'store')->name('.store');
            Route::get('/{patient}', 'show')->whereNumber('patient')->name('.show');
            Route::get('/{patient}/intake', 'intake')->whereNumber('patient')->name('.intake');
            Route::get('/{patient}/edit', 'edit')->whereNumber('patient')->name('.edit');
            Route::put('/{patient}', 'update')->whereNumber('patient')->name('.update');
        });
        Route::prefix('facilities')->name('.facilities')->controller(FacilityController::class)->group(function () {
            Route::get('/', 'index');
            Route::post('/', 'store')->name('.store');
            Route::put('/{facility}', 'update')->name('.update');
        });
        Route::get('/run-sheet/{vehicle}', [ReportController::class, 'runSheet'])->name('.run-sheet');
    });

    Route::middleware('permission:trips_crew')->prefix('crew')->name('.crew')->controller(CrewController::class)->group(function () {
        Route::get('/', 'index');
        Route::get('/data', 'data')->name('.data');
        Route::post('/location', 'location')->name('.location');
        Route::post('/{trip}/next', 'status')->whereNumber('trip')->name('.next');
    });

    Route::middleware('permission:trips_reports,trips_supervise')->controller(ReportController::class)->group(function () {
        Route::get('/reports', 'index')->name('.reports');
        Route::get('/reports.csv', 'csv')->name('.reports.csv');
    });

    Route::middleware('permission:trips_supervise')->group(function () {
        Route::get('/reports/billing.csv', [ReportController::class, 'billing'])->name('.reports.billing');
        Route::prefix('settings')->name('.settings')->controller(SettingsController::class)->group(function () {
            Route::get('/', 'index');
            Route::put('/', 'update')->name('.update');
            Route::post('/gps-key', 'newKey')->name('.gps-key');
            Route::put('/trucks', 'trucks')->name('.trucks');
        });
    });
});
