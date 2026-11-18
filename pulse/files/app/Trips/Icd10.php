<?php

namespace App\Trips;

/**
 * ICD-10-CM codes that come up often on stretcher transports, for the intake box's suggestions.
 * Any valid code can be typed; this list only saves looking the common ones up.
 */
class Icd10
{
    public const COMMON = [
        'N18.6' => 'End stage renal disease',
        'Z99.2' => 'Dependence on renal dialysis',
        'Z74.01' => 'Bed confinement status',
        'Z74.09' => 'Other reduced mobility',
        'R26.2' => 'Difficulty in walking, not elsewhere classified',
        'R26.81' => 'Unsteadiness on feet',
        'R29.6' => 'Repeated falls',
        'M62.81' => 'Muscle weakness (generalized)',
        'R53.1' => 'Weakness',
        'R53.81' => 'Other malaise (debility)',
        'R41.82' => 'Altered mental status, unspecified',
        'F03.90' => 'Unspecified dementia without behavioral disturbance',
        'R55' => 'Syncope and collapse',
        'R56.9' => 'Unspecified convulsions',
        'R06.02' => 'Shortness of breath',
        'I50.9' => 'Heart failure, unspecified',
        'I48.91' => 'Unspecified atrial fibrillation',
        'I21.9' => 'Acute myocardial infarction, unspecified',
        'I63.9' => 'Cerebral infarction, unspecified',
        'J44.1' => 'COPD with (acute) exacerbation',
        'J44.9' => 'Chronic obstructive pulmonary disease, unspecified',
        'J18.9' => 'Pneumonia, unspecified organism',
        'J96.01' => 'Acute respiratory failure with hypoxia',
        'A41.9' => 'Sepsis, unspecified organism',
        'N39.0' => 'Urinary tract infection, site not specified',
        'E86.0' => 'Dehydration',
        'E11.9' => 'Type 2 diabetes mellitus without complications',
        'E66.01' => 'Morbid (severe) obesity due to excess calories',
        'L89.90' => 'Pressure ulcer of unspecified site, unspecified stage',
        'G80.9' => 'Cerebral palsy, unspecified',
        'F20.9' => 'Schizophrenia, unspecified',
        'F29' => 'Unspecified psychosis',
        'R45.851' => 'Suicidal ideations',
        'C80.1' => 'Malignant (primary) neoplasm, unspecified',
        'Z51.11' => 'Encounter for antineoplastic chemotherapy',
        'Z51.0' => 'Encounter for antineoplastic radiation therapy',
        'Z93.0' => 'Tracheostomy status',
        'Z93.1' => 'Gastrostomy status',
        'Z99.11' => 'Dependence on respirator (ventilator) status',
        'Z99.81' => 'Dependence on supplemental oxygen',
        'Z96.641' => 'Presence of right artificial hip joint',
        'Z09' => 'Follow-up exam after completed treatment',
    ];

    /** Letter, two characters, then an optional dot and up to four more (A00 to Z99.9999). */
    public const PATTERN = '/^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/i';

    public static function picker(): array
    {
        return collect(self::COMMON)->map(fn ($d, $c) => ['id' => $c, 'name' => $c, 'hint' => $d])->values()->all();
    }
}
