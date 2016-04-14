'use strict';

var NestedSurface = require('./NestedSurface');
var ContainerEditor = require('./ContainerEditor');

function NestedContainerEditor() {
  NestedContainerEditor.super.apply(this, arguments);
}

NestedContainerEditor.Prototype = function() {
  var _super = Object.getPrototypeOf(this);

  this.render = function($$) {
    var el = _super.render.call(this, $$);
    el.addClass('sc-nested-container-editor');
    return el;
  };

  this.renderSurface = function($$) {
    return $$(ContainerEditor, this.props);
  };

};

NestedSurface.extend(NestedContainerEditor);

module.exports = NestedContainerEditor;
