@extends('layouts.app')

{{-- Dispatch > Payors: the one shared payor list. Not PHI: no patient is named here, only counts. --}}
@section('band')
    <h1>Payors</h1>
    <p>Every patient's payors come from this one list. A payor a dispatcher types that isn't on it is added once and marked "typed", so check those for spelling. If the same company ends up here twice, merge the copy into the one to keep.</p>
@endsection

@section('content')
@php($edit = $payers->firstWhere('id', (int) request('edit')))
@php($others = $edit ? $payers->where('id', '!=', $edit->id) : collect())
<div class="stack">
    <div class="card">
        <h2>{{ $edit ? 'Edit '.$edit->name : 'Add a payor' }}</h2>
        <form method="post" action="{{ $edit ? route('trips.payers.update', $edit) : route('trips.payers.store') }}">@csrf
            @if ($edit) @method('put') @endif
            <div class="field-row">
                <div class="field" style="grid-column:span 2"><label for="py-name">Name</label><input type="text" id="py-name" name="name" value="{{ old('name', $edit?->name) }}" required maxlength="100"></div>
                <div class="field"><label for="py-kind">Kind</label><select id="py-kind" name="kind">@foreach ($kinds as $k => $l)<option value="{{ $k }}" @selected(old('kind', $edit?->kind ?? 'commercial') === $k)>{{ $l }}</option>@endforeach</select></div>
                <div class="field"><label for="py-code">Payer id (electronic)</label><input type="text" id="py-code" name="payer_code" value="{{ old('payer_code', $edit?->payer_code) }}" maxlength="30"></div>
                <div class="field"><label for="py-phone">Phone</label><input type="text" id="py-phone" name="phone" value="{{ old('phone', $edit?->phone) }}" maxlength="30"></div>
            </div>
            <div class="field"><label for="py-notes">Notes</label><input type="text" id="py-notes" name="notes" value="{{ old('notes', $edit?->notes) }}" maxlength="300" placeholder="Needs prior auth for repeat trips, fax PCS to …"></div>
            @if ($edit)<label class="check"><input type="hidden" name="active" value="0"><input type="checkbox" name="active" value="1" @checked(old('active', $edit->active))> Active (offered when typing a payor)</label>@endif
            <p>
                <button type="submit" class="btn">{{ $edit ? 'Save' : 'Add payor' }}</button>
                @if ($edit)<a class="btn btn-outline" href="{{ route('trips.payers') }}">Cancel</a>@endif
            </p>
        </form>
        @if ($edit && $others->isNotEmpty())
            <form method="post" action="{{ route('trips.payers.merge', $edit) }}" class="field-row" style="align-items:end;border-top:1px solid var(--line);padding-top:12px"
                  onsubmit="return confirm('Move every patient from {{ addslashes($edit->name) }} to the payor you picked, and remove {{ addslashes($edit->name) }} from the list? This can\'t be undone.')">@csrf
                <div class="field" style="grid-column:span 2"><label for="py-into">Duplicate? Merge {{ $edit->name }} into</label>
                    <select id="py-into" name="into" required><option value="">Pick the payor to keep</option>@foreach ($others as $o)<option value="{{ $o->id }}">{{ $o->name }}</option>@endforeach</select></div>
                <div class="field"><button type="submit" class="btn btn-outline">Merge</button></div>
            </form>
        @endif
    </div>

    <div class="card">
        <h2>{{ $payers->count() }} {{ str('payor')->plural($payers->count()) }}</h2>
        <div class="table-wrap"><table>
            <tr><th>Name</th><th>Kind</th><th>Payer id</th><th>Phone</th><th>Patients</th><th></th></tr>
            @foreach ($payers as $p)
                <tr @class(['struck' => ! $p->active])>
                    <td><strong>{{ $p->name }}</strong>@if ($p->added_from === 'typed') <span class="pill pill-amber">Typed in</span>@endif @unless ($p->active)<div class="hint">Turned off</div>@endunless @if ($p->notes)<div class="hint">{{ $p->notes }}</div>@endif</td>
                    <td>{{ $kinds[$p->kind] ?? $p->kind }}</td>
                    <td>{{ $p->payer_code }}</td>
                    <td>{{ $p->phone }}</td>
                    <td>{{ $p->patient_payers_count }}</td>
                    <td><a class="btn btn-small btn-outline" href="{{ route('trips.payers') }}?edit={{ $p->id }}">Edit</a></td>
                </tr>
            @endforeach
        </table></div>
    </div>
</div>
@endsection
