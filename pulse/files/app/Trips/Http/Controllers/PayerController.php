<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Trips\Models\Payer;
use App\Trips\Payers;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The payor list. Dispatchers pick from it (payers.json); typing a new one adds it once. Supervisors
 * tidy it on Dispatch > Payors: rename, set the kind and payer id, turn one off, or merge a duplicate.
 */
class PayerController extends Controller
{
    /** For the type-to-search box: the active payors. */
    public function picker()
    {
        return response()->json(Payer::where('active', true)->orderBy('name')->get()
            ->map(fn (Payer $p) => ['id' => $p->id, 'name' => $p->name, 'hint' => trim((Payer::KINDS[$p->kind] ?? '').($p->payer_code ? ' · '.$p->payer_code : ''))])->values());
    }

    public function index()
    {
        return view('trips.payers', [
            'payers' => Payer::withCount('patientPayers')->orderByDesc('active')->orderBy('name')->get(),
            'kinds' => Payer::KINDS, 'title' => 'Payors',
        ]);
    }

    public function store(Request $request)
    {
        $in = $this->validated($request);
        if (Payer::where('name_key', Payer::keyFor($in['name']))->exists()) {
            return back()->withInput()->with('error', "{$in['name']} is already on the list.");
        }
        $p = Payer::create($in + ['name_key' => Payer::keyFor($in['name']), 'added_from' => 'list']);

        return back()->with('status', "Added {$p->name}.");
    }

    public function update(Request $request, Payer $payer)
    {
        $in = $this->validated($request, $payer);
        $key = Payer::keyFor($in['name']);
        if (Payer::where('name_key', $key)->whereKeyNot($payer->id)->exists()) {
            return back()->withInput()->with('error', "{$in['name']} is already on the list. Merge the two instead.");
        }
        $old = $payer->name;
        $payer->update($in + ['name_key' => $key, 'active' => $request->boolean('active'), 'added_from' => 'list']); // saved by a supervisor: checked
        if ($old !== $payer->name) {
            // Open trips show the payor by name: keep them in step.
            \Illuminate\Support\Facades\DB::table('trips')->where('payer', $old)->whereNotIn('status', ['completed', 'cancelled'])->update(['payer' => $payer->name]);
            \Illuminate\Support\Facades\DB::table('trips')->where('secondary_payer', $old)->whereNotIn('status', ['completed', 'cancelled'])->update(['secondary_payer' => $payer->name]);
        }
        audit_note("Changed payor {$payer->name}".($old !== $payer->name ? " (was {$old})" : '').'.');

        return redirect()->route('trips.payers')->with('status', "Saved {$payer->name}.");
    }

    public function merge(Request $request, Payer $payer, Payers $payers)
    {
        $in = $request->validate(['into' => ['required', 'integer', Rule::exists('trip_payers', 'id'), Rule::notIn([$payer->id])]], ['into.not_in' => 'Pick a different payor to merge into.']);
        $into = Payer::findOrFail($in['into']);
        $name = $payer->name;
        $n = $payers->merge($payer, $into);
        audit_note("Merged payor {$name} into {$into->name}: {$n} ".str('patient')->plural($n).' moved.');

        return redirect()->route('trips.payers')->with('status', "Merged {$name} into {$into->name}. {$n} ".str('patient')->plural($n).' moved.');
    }

    private function validated(Request $request, ?Payer $p = null): array
    {
        $in = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'kind' => ['required', Rule::in(array_keys(Payer::KINDS))],
            'payer_code' => ['nullable', 'string', 'max:30'],
            'phone' => ['nullable', 'string', 'max:30'],
            'notes' => ['nullable', 'string', 'max:300'],
        ]);
        $in['name'] = Payer::tidy($in['name']);

        return $in;
    }
}
