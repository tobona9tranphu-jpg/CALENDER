(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleUtils = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function minutes(value) {
    const match = String(value || '').match(/(?:T|\s)?(\d{2}):(\d{2})/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function overlaps(first, second) {
    return minutes(first.start) < minutes(second.end)
      && minutes(second.start) < minutes(first.end);
  }

  return { minutes, overlaps };
}));
