@extends('layouts.app')

{{-- Dispatch > Patients. Searches are POSTed so names stay out of URLs and server logs. --}}
@section('band')
    <h1>Patients</h1>
    <p>Transport patients on file, with their paperwork and every past and scheduled trip. Names, dates of birth and contact details are encrypted, and opening a record is logged.</p>
@endsection

@section('content')
<div class="stack">
    <div class="card">
        <form method="post" action="{{ route('trips.patients.search') }}" autocomplete="off">@csrf
            <div class="field-row">
                <div class="field"><label for="pt-q">Find a patient</label><input id="pt-q" type="search" name="q" value="{{ $q }}" maxlength="60" placeholder="Last name, first name, P-number or DOB (YYYY-MM-DD)" autofocus></div>
                <div class="field"><label>&nbsp;</label><label class="check"><input type="hidden" name="inactive" value="0"><input type="checkbox" name="inactive" value="1" @checked($inactive)> Include inactive</label></div>
            </div>
            <button type="submit" class="btn">Search</button>
            <a class="btn btn-outline" href="{{ route('trips.patients.create') }}">+ Add a patient</a>
        </form>
    </div>

    @if ($results !== null)
        <div class="card">
            <h2>{{ $results->count() }} {{ str('patient')->plural($results->count()) }}@if ($q !== '') matching “{{ $q }}”@endif</h2>
            @if ($results->isEmpty())
                <p class="empty">Nobody on file matches. Check the spelling, or add the patient.</p>
            @else
                <div class="table-wrap"><table>
                    <tr><th>Patient #</th><th>Name</th><th>DOB</th><th>Primary payor</th><th>Paperwork</th></tr>
                    @foreach ($results as $p)
                        <tr @class(['struck' => ! $p->active])>
                            <td><a href="{{ route('trips.patients.show', $p) }}">{{ $p->patient_number }}</a></td>
                            <td><a href="{{ route('trips.patients.show', $p) }}">{{ $p->fullName() }}</a>@unless ($p->active)<div class="hint">Inactive</div>@endunless</td>
                            <td>{{ $p->dob }} <span class="hint">({{ $p->age() }})</span></td>
                            <td>{{ $p->primaryPayer()?->payer?->name ?: '—' }}</td>
                            <td>
                                @if (! $p->pcs_expires)<span class="pill pill-amber">No PCS date</span>
                                @elseif ($p->pcs_expires->isPast())<span class="pill pill-red">PCS expired</span>
                                @elseif ($p->pcs_expires->lt(today()->addDays(7)))<span class="pill pill-amber">PCS expiring</span>
                                @else<span class="pill pill-green">PCS to {{ $p->pcs_expires->format('m/d/Y') }}</span>@endif
                                @if ($p->prior_auth_expires && $p->prior_auth_expires->isPast())<span class="pill pill-red">Auth expired</span>@endif
                            </td>
                        </tr>
                    @endforeach
                </table></div>
            @endif
        </div>
    @else
        <p class="hint">Search to see patients. The list isn't shown until you search, so names don't sit on an open screen.</p>
    @endif
</div>
@endsection
