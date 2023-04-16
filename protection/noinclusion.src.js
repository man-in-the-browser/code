// jshint esversion: 11

(function() {

    'use strict';
    
    var block = true;
    var domainsWhitelist = ['example.com']; // Whitelist dei domini validi

    var log = function(msg) {
        console.log(msg);
    };

    // La funzione definisce una whitelist basata su domini. Tutte le risorse interne sono di default viste come in whitelist
    var isInWhitelist = function(resource) {
        let re = /^(?:[^:\/]+:\/\/)([^\/]+)(\/.*)?$/;
        let domain = re.exec(resource);
        return domain ? domainsWhitelist.includes(domain[1].toLowerCase()) : true; 
    };

    var ElementFeature = class {
        constructor(attributes, checkAlways = false) {
            this.attributes = Array.isArray(attributes) ? attributes : [attributes];
            this.checkAlways = checkAlways;
        }

        handleOutOfPageScope(element) {

            this.attributes.forEach(attribute => {
                let attrValue = element[attribute];
                if (this.checkAlways || !isInWhitelist(attrValue)) {
                    log('Found value ' + attrValue + ' on attribute ' + attribute + ' of ' + element.tagName);
                    if (block) {
                        element.removeAttribute(attribute);
                    }
                }
            });
        }
    };

    var ValueElementFeature = class extends ElementFeature  {
        constructor() {
            super('value', true);
        }
        
        handleOutOfPageScope(element) {
            if (element.defaultValue !== element.value) {
                log('Changed ' + element.tagName + ' to new value ' + element.value);
            }
        }
    };

    var elementFeatures = {
        'script': new ElementFeature('src'), 
        'img': new ElementFeature('src'), 
        'form': new ElementFeature('action'),
        'link': new ElementFeature('href'),
        'input': new ValueElementFeature(), 
        'a': new ElementFeature('href')
    };

    var checkElement = function (element) {

        let elementFeature = elementFeatures[element.tagName.toLowerCase()];
        elementFeature?.handleOutOfPageScope(element);
    };

    // L'hook non e' in grado di bloccare le modifiche sugli attributi, per cui 
    // eventuali blocchi vengono fatti dal MutationObserver o dagli oggetti proxy
    var propertyHook = function(element, elementFeature) {

        elementFeature.attributes.forEach(attribute => {
    
            let elementPrototype = Object.getPrototypeOf(element);
            if (elementPrototype.hasOwnProperty(attribute)) {
                let descriptor = Object.getOwnPropertyDescriptor(elementPrototype, attribute);
                Object.defineProperty(element, attribute, {
                    get: function() {
                        return descriptor.get.apply(this, arguments);
                    },
                    set: function() {
                        let oldValue = this[attribute];
                       
                        descriptor.set.apply(this, arguments);
                        let newValue = this[attribute];
                        
                        if (elementFeature.checkAlways || !isInWhitelist(newValue)) {
                            log('Changed from ' + oldValue + ' to ' + newValue + ' on ' + element.tagName);
                        }

                        return newValue;
                    }
                });
            }
        });
    };

    var delegated = [];

    var uid = function(i) {
        return function() { 
            return i++; 
        };
    }(1);

    // La funzione permette di definire una hook generica sulle varie funzioni 
    // per la creazione degli element sul DOM
    var createDomHook = function(create) {
        return function() {

            let ret = create.apply(this, arguments);
            if (elementFeatures[ret.tagName.toLowerCase()]) {
                propertyHook(ret, elementFeatures[ret.tagName.toLowerCase()]);
            }

            let delegatedUid = uid();

            delegated[delegatedUid] = ret;

            let validator = {
                set: (obj, prop, value) => {

                    if (prop === 'delegated') {
                        return;
                    }

                    if (prop === 'style') {
                        log('Set inline style on ' + obj.tagName + ' with value ' + value);
                        if (block) { 
                            return;
                        }
                    }

                    let targets = ['src', 'href', 'action'];

                    if (targets.includes(prop.toLowerCase()) && !isInWhitelist(value)) {
                        log('Set value ' +  value + ' on ' + prop + ' of ' + obj.tagName);
                        if (block) { 
                            return;
                        }
                    }

                    obj[prop] = value;
                    
                    return true;
                },
                get: (obj, prop, receiver) => {

                        let propValue = obj[prop];
                        if (prop === 'delegated') {
                            return delegatedUid;
                        }
                        else if (typeof propValue !== 'function'){
                             return propValue;
                        }
                        else {
                             return function() {
                                  return propValue.apply(obj, arguments);
                             };
                        }
		        }
            };

            return new Proxy(ret, validator);
        };
    };

    document.createElement = createDomHook(document.createElement);
    document.createElementNS = createDomHook(document.createElementNS);
    Node.prototype.cloneNode = createDomHook(Node.prototype.cloneNode);

    var delegatedHandler = function(originalFunction) {
        return function() {
            let args = [].slice.call(arguments).flatMap(arg => { 
                return arg.delegated ? delegated[arg.delegated] : arg; 
            });
           
            let thisInstance = this.delegated ? delegated[this.delegated] : this;
            return originalFunction.apply(thisInstance, args);
        };
    };

    Node.prototype.appendChild = delegatedHandler(Node.prototype.appendChild);
    Node.prototype.removeChild = delegatedHandler(Node.prototype.removeChild);
    Node.prototype.insertBefore = delegatedHandler(Node.prototype.insertBefore);
    Node.prototype.replaceChild = delegatedHandler(Node.prototype.replaceChild);

    // Controllo caricamento risorse esterne via Image    
    (function() {
    	var OriginalImage = window.Image;
    	window.Image = function() {
            let img = new OriginalImage();
            let validator = {
                set: (obj, prop, value) => {

                    if (prop.toLowerCase() === 'src' && !isInWhitelist(value)) {
                        log('Call to image ' +  value);

                        if (block) {
                            return;
                        }

                    }
    
                    obj[prop] = value;
    
                    return true;
                }
            };
            return new Proxy(img, validator);
    	};
    })();
 
    // Controllo connessioni effettuate via fetch
    (function() {
        var originalFetch = window.fetch;
        window.fetch = function() {

            if (!isInWhitelist(arguments[0])) {
                log('Fetch to resource ' + arguments[0]);
                
                if (block) {
                    return;
                }
            }

            return originalFetch([].slice.call(arguments));
        };
    })();

    // Controllo connessioni effettuate via open
    (function() {
        var xhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {

            if (!isInWhitelist(arguments[1])) {
                log('Open new connection to ' + arguments[1]);
                
                if (block) {
                    return;
                }
            }

            return xhrOpen.apply(this, [].slice.call(arguments));
        };
    })();

    // Controllo apertura nuove finestre
    (function() {
        var open = window.open;
        window.open = function() {

            if (!isInWhitelist(arguments[0])) {
                log('New window open to ' + arguments[0]);
                
                if (block) {
                    return;
                }
            }

            return open([].slice.call(arguments));
        };
    })();

    var blockFunction = function() {
        log('Blocked execute function attempt with content ' + arguments[0]);
    };

    // L'uso delle seguenti funzioni e' inibito al fine di limitare gli impatti di sicurezza
    document.write = blockFunction;
    document.writeln = blockFunction;
    window.eval = blockFunction;
    Element.prototype.insertAdjacentHTML = blockFunction;

    document.addEventListener("DOMContentLoaded", function() {
        Object.keys(elementFeatures).forEach(e => {
            let elements = document.getElementsByTagName(e);
           
            for (let element of elements) { 

                checkElement(element);
                // Eventuali cambiamenti su property non sono gestite dal mutation observer.
                // L'hook viene definito solo sugli elementi gia' nel DOM: nel caso di elementi 
                // a runtime questi vengono gia' intercettati dal proxy. 
                let elementFeature = elementFeatures[e];

                propertyHook(element, elementFeature);
                     
            }
        });

        try {

            var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
            var observer = new MutationObserver(function (mutations, observer) {
                for (let mutation of mutations) {   
                    checkElement(mutation.target);
                }
            });
    
            observer.observe(document, {
                subtree: true,
                attributes: true
            });
        } 
        catch (e) {
            log(e);
        }
    });
        
})();