(function(root) {
  'use strict';
  const STUDY_ID = 'interaction-study-20260920-v2';
  const QUESTIONS = {
    camera: ['Camera control', 'Which video better follows the requested camera motion?'],
    quality: ['Visual quality', 'Which video has better visual quality, with clearer details, fewer artifacts, and less flickering?'],
    interaction: ['Interaction fidelity', 'Which video more faithfully preserves the interaction in the input, including object motion, contact relationships, and changes in object state?'],
    overall: ['Overall preference', 'Which video is better overall?']
  };
  function validateManifest(m) {
    if (m.studyId !== STUDY_ID || m.schemaVersion !== 2 || m.groups.length !== 3) throw new Error('Please reload the updated study.');
    const ids = new Set();
    for (const g of m.groups) {
      if (ids.has(g.id) || !['criteria', 'overall'].includes(g.kind) || g.cases.length !== 25 || new Set(g.cases.map(c => c.id)).size !== 25) throw new Error('Invalid study group.');
      ids.add(g.id);
      for (const c of g.cases) {
        if (c.candidates.length !== (g.kind === 'overall' ? 2 : 4) || new Set(c.candidates).size !== c.candidates.length || !(c.frames > 0 && c.fps > 0)) throw new Error('Invalid comparison.');
        for (const id of [c.input, c.camera, ...c.candidates]) {
          const a = m.assets[id];
          if (!a || !/^(media\/[a-f0-9]{24}\.bin|shared\/[a-f0-9]{24}\.(mp4|webm))$/.test(a.src) || a.encodedFrames < c.frames || !(a.encodedFps > 0)) throw new Error('Invalid video.');
        }
      }
    }
    return m;
  }
  function trials(manifest, assignment) {
    const group = manifest.groups.find(g => g.id === assignment.groupId);
    if (!group || !Number.isSafeInteger(assignment.ordinal) || assignment.ordinal < 0) throw new Error('Invalid assignment.');
    return group.cases.map(c => { const offset = assignment.ordinal % c.candidates.length; return {...c, candidates:c.candidates.slice(offset).concat(c.candidates.slice(0, offset))}; });
  }
  function questions(kind) { return kind === 'overall' ? ['overall'] : ['camera', 'quality', 'interaction']; }
  function validChoices(choices, kind) { const keys = questions(kind), allowed = kind === 'overall' ? ['a','b','tie'] : ['a','b','c','d']; return keys.length === Object.keys(choices).length && keys.every(k => allowed.includes(choices[k])); }
  const api = {STUDY_ID, QUESTIONS, validateManifest, trials, questions, validChoices};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StudyCore = api;
})(typeof window === 'undefined' ? globalThis : window);
