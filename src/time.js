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

  function smooth(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* How dark it is for the night lights, 0 (day) .. 1 (night), from the same
   * clock as the sun (main.js sunModel: sunrise 6:00, sunset 18:00). Lights
   * come on through dusk (17:00-19:00) and go out through dawn (5:00-7:00),
   * so they are half on exactly at sunset and sunrise. Continuous at every
   * hour: the day slider never makes them pop. */
  function nightAmount(hour) {
    var h = ((+hour % 24) + 24) % 24;
    return h >= 12 ? smooth(17, 19, h) : 1 - smooth(5, 7, h);
  }

  SM.formatClock = formatClock;
  SM.nightAmount = nightAmount;
})(window.SM = window.SM || {});
