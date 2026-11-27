const crypto = require('node:crypto').webcrypto;
const dispatched = [];
const prefs = {};
var window = {
    appready: true,
    location: {protocol:'http:'},
    Lampa: { Params: {select() {}}, Player: {listener: {follow(_, fn) { this.external = fn; }}}, Storage: {
        field: key => prefs[key], value: key => prefs[key],
        get: (key, fallback) => Object.hasOwn(prefs, key) ? prefs[key] : fallback,
        set: (key, value) => { prefs[key] = value; }
    } }
};
const el = {content:'', style:{}, setAttribute(){}, appendChild(){}, matches(){return false;}, querySelectorAll(){return [];}};
class MutationObserver { observe(){} }
var document = {body:el, head:el, querySelector:()=>null, createElement:()=>({...el}), addEventListener(){}, activeElement: {dispatchEvent: (event) => dispatched.push(event)}};
class KeyboardEvent {
    constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
    }
}
