/* ONE plain-English status per photo scene (Intake). Pure: derived from the
   scene the API returns — its validity `reasons`, `missingCameras`,
   `exclusionReason`, the same-food confirmation and the photos themselves.
   The data model is unchanged; this only decides what to say and which single
   action to offer. Order = the order in which the owner has to fix things. */
import type { ArtifactDto, SceneDto } from './intake-types'
import type { Vantage } from './format'

export type SceneStatusKind =
  | 'ready'
  | 'check_same_food'
  | 'check_camera'
  | 'check_duplicate'
  | 'different_food'
  | 'no_photo'
  | 'no_notes'

export type SceneStatus = {
  kind: SceneStatusKind
  tone: 'ready' | 'check' | 'blocked'
  title: string
  explain: string
  /** cameras with no photo (kind = no_photo) */
  missing?: Vantage[]
  /** the photo whose camera the importer guessed (kind = check_camera) */
  guessed?: ArtifactDto
}

const usable = (s: SceneDto) => s.artifacts.filter((a) => !a.excludeFromExport && a.vantage)

export function sceneStatus(s: SceneDto): SceneStatus {
  if (s.valid) {
    return { kind: 'ready', tone: 'ready', title: 'Ready for the study', explain: 'Both cameras have a photo, your notes are in, and you confirmed the photos show the same food.' }
  }
  if (s.exclusionReason === 'different_plates') {
    return {
      kind: 'different_food',
      tone: 'blocked',
      title: 'Not usable: the photos show different food',
      explain: 'You marked these photos as showing different food, so this scene is left out of the study.',
    }
  }
  if (s.missingCameras.length > 0) {
    const names = s.missingCameras.join(' or ')
    return {
      kind: 'no_photo',
      tone: 'blocked',
      title: `Not usable: no ${names} photo`,
      explain: `The study compares the phone and the glasses, so it needs one photo from each. Add the ${names} photo if you have one.`,
      missing: s.missingCameras,
    }
  }
  if (!s.notes || !s.notes.trim()) {
    return { kind: 'no_notes', tone: 'blocked', title: 'Not usable: no notes yet', explain: 'Without your notes there is nothing to compare the models against. Open this meal and paste your notes for this photo.' }
  }
  const live = usable(s)
  const guessed = live.find((a) => a.vantageGuessed)
  if (guessed) {
    return {
      kind: 'check_camera',
      tone: 'check',
      title: 'Needs your check: which camera took this photo?',
      explain: `The importer could not tell which camera took the photo labelled “${guessed.vantage}?”. Pick the right one.`,
      guessed,
    }
  }
  const seen = new Set<Vantage>()
  const dup = live.find((a) => (seen.has(a.vantage!) ? true : (seen.add(a.vantage!), false)))
  if (dup) {
    return {
      kind: 'check_duplicate',
      tone: 'check',
      title: `Needs your check: two ${dup.vantage} photos`,
      explain: 'A scene can hold only one photo per camera. Remove the one that does not belong (hover over the photo and press Remove).',
    }
  }
  if (!s.sameSceneConfirmed) {
    return {
      kind: 'check_same_food',
      tone: 'check',
      title: 'Needs your check: do both photos show the same food?',
      explain: 'Click a photo to look closely. The scene is used only when every camera shows the same plates.',
    }
  }
  // not valid for a reason this screen has no wording for yet — show the raw reason rather than nothing
  return { kind: 'check_same_food', tone: 'check', title: 'Needs your check', explain: s.reasons.join(' · ') || 'This scene is not ready yet.' }
}

/** The list shown in the "What do these mean?" help. */
export const STATUS_HELP: Array<{ tone: SceneStatus['tone']; title: string; meaning: string }> = [
  { tone: 'ready', title: 'Ready for the study', meaning: 'Both cameras have a photo, your notes are in, and you confirmed the photos show the same food. Nothing more to do.' },
  { tone: 'check', title: 'Needs your check: do both photos show the same food?', meaning: 'Look at the photos and answer “Yes, same food” or “No, different”. Only scenes you confirmed are used.' },
  { tone: 'check', title: 'Needs your check: which camera took this photo?', meaning: 'The importer guessed the camera from the file. Pick the camera that really took the photo.' },
  { tone: 'check', title: 'Needs your check: two photos from the same camera', meaning: 'Remove the extra photo so each camera has exactly one.' },
  { tone: 'blocked', title: 'Not usable: no phone photo / no glasses photo', meaning: 'One of the two cameras has no photo. Add it from the unsorted photos, or leave the scene out.' },
  { tone: 'blocked', title: 'Not usable: no notes yet', meaning: 'Your notes for this photo are missing. Open the meal and paste them in.' },
  { tone: 'blocked', title: 'Not usable: the photos show different food', meaning: 'You answered “No, different”. You can change your answer at any time.' },
]
