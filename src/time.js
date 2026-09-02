/* Clock formatting shared by the day slider and the headless verification. */
(function (SM) {
  'use strict';

  function formatClock(hour) {
    var wrapped = ((+hour % 24) + 24) % 24;
    var hours = Math.floor(wrapped);
    var minutes = Math.round((wrapped - hours) * 60);

    if (minutes === 60) {
      hours = (hours + 1) % 24;
      minutes = 0;
    }
    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
  }

  SM.formatClock = formatClock;
})(window.SM = window.SM || {});
