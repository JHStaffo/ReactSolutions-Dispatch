{{-- One payor on the patient form. $i is the row's index (or __i__ in the template), $r its values. --}}
@php($f = fn ($k) => $r[$k] ?? '')
@php($rel = ($r['subscriber_relationship'] ?? null) ?: 'self')
<div class="payor-row">
    <div class="payor-row-head">
        <strong data-pos>Payor</strong>
        <span>
            <button type="button" class="btn btn-small btn-outline" data-move="up" aria-label="Move up">↑</button>
            <button type="button" class="btn btn-small btn-outline" data-move="down" aria-label="Move down">↓</button>
            <button type="button" class="btn btn-small btn-outline" data-move="remove">Remove</button>
        </span>
    </div>
    <div class="field-row">
        <div class="field" style="grid-column:span 2"><label>Payor<input type="text" name="payors[{{ $i }}][payer_name]" value="{{ $f('payer_name') }}" maxlength="100" data-payor-name placeholder="Start typing: Medicare, Sample Health…"></label>
            <input type="hidden" name="payors[{{ $i }}][payer_id]" value="{{ $f('payer_id') }}" data-payor-id>
            @error("payors.$i.payer_name")<div class="error">{{ $message }}</div>@enderror</div>
        <div class="field"><label>Member ID<input type="text" name="payors[{{ $i }}][member_id]" value="{{ $f('member_id') }}" maxlength="60"></label></div>
        <div class="field"><label>Group #<input type="text" name="payors[{{ $i }}][group_number]" value="{{ $f('group_number') }}" maxlength="60"></label></div>
    </div>
    <div class="field-row">
        <div class="field"><label>Policy holder<select name="payors[{{ $i }}][subscriber_relationship]" data-rel>@foreach ($rels as $k => $l)<option value="{{ $k }}" @selected($rel === $k)>{{ $k === 'self' ? 'The patient' : $l }}</option>@endforeach</select></label></div>
        <div class="field" data-sub><label>Policy holder's name<input type="text" name="payors[{{ $i }}][subscriber_name]" value="{{ $f('subscriber_name') }}" maxlength="100"></label></div>
        <div class="field"><label>Effective<input type="date" name="payors[{{ $i }}][effective_from]" value="{{ $f('effective_from') }}"></label></div>
        <div class="field"><label>Ends<input type="date" name="payors[{{ $i }}][effective_to]" value="{{ $f('effective_to') }}"></label>
            @error("payors.$i.effective_to")<div class="error">{{ $message }}</div>@enderror</div>
        <div class="field"><label>Eligibility checked<input type="date" name="payors[{{ $i }}][eligibility_checked_on]" value="{{ $f('eligibility_checked_on') }}"></label></div>
    </div>
</div>
