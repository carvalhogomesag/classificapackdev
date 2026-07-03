// storage.js
export function saveData(drivers, intervals, assignments) {
    localStorage.setItem('cp_drivers', JSON.stringify(drivers));
    localStorage.setItem('cp_intervals', JSON.stringify(intervals));
    localStorage.setItem('cp_assignments', JSON.stringify(assignments));
}