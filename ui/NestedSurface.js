'use strict';

var each = require('lodash/each');
var extend = require('lodash/extend');
var IsolatedNodeComponent = require('./IsolatedNodeComponent');

function NestedSurface() {
  NestedSurface.super.apply(this, arguments);

  // maintaining a set of child editors to be able to propagate
  // focus and blur signals
  this._nestedEditors = {};
}

NestedSurface.Prototype = function() {

  var _super = NestedSurface.super.prototype;

  this.getChildContext = function() {
    return {
      // acting as a proxy to the injected surfaceManager
      surfaceManager: this,
      _parentEditor: this,
    };
  };

  this.didMount = function() {
    _super.didMount.call(this);

    this.context.documentSession.on('selection:changed', this.onSelectionChange, this);
    this.context.surface._registerNestedEditor(this);
    if (this.context._parentEditor) {
      this.context._parentEditor._registerNestedEditor(this);
    }
  };

  this.dispose = function() {
    _super.dispose.call(this);

    this.refs.editor.off(this);
    this.context.documentSession.off(this);
    this.context.surface._deregisterNestedEditor(this);
    if (this.context._parentEditor) {
      this.context._parentEditor._deregisterNestedEditor(this);
    }
  };

  this.render = function($$) {
    /* jshint unused: false */
    var el = _super.render.apply(this, arguments);
    el.addClass('sc-nested-surface');
    return el;
  };

  this.renderContent = function($$) {
    var ComponentClass = this.props.ComponentClass;
    var editorProps = extend({}, this.props);
    if (!this.mode) {
      editorProps.enabled = false;
    }
    return $$(ComponentClass, editorProps).ref('editor');
  };

  // TODO: Doing this implicitly is strange.
  // Need to rethink. I think rendering the selection should be initiated by
  // the ContainerEditor/DOMSelection
  // E.g., the following impl does not consider cases where the
  // selection focus goes into another nested editor.
  this.onSelectionChange = function(sel) {
    // console.log('NestedSurface.onSelectionChange', sel);
    var parentSurface = this.context.surface;
    if (sel.surfaceId === parentSurface.name) {
      // select
      if(sel.isContainerSelection() &&
         sel.containsNode(this.props.node.id) &&
         !this.mode) {
        console.log('NestedSurface: enabling selection', this.props.node.id);
        return this._setSelected();
      } else {
        this._blurEditor();
      }
    }
  };

  this.onSurfaceFocused = function() {
    console.log('NestedSurface.onSurfaceFocused', this.props.node.id);
    if (this.mode !== 'focused') {
      this._focusEditor(true, true);
    }
  };

  this.onSurfaceBlurred = function() {
    console.log('NestedSurface.onSurfaceBlurred', this.props.node.id);
    this._blurEditor(true, true);
  };

  this._setSelected = function() {
    _super._setSelected.apply(this, arguments);
    this.refs.editor.enable();
  };

  this._focusEditor = function(bubbleUp, bubbleDown) {
    this.mode = 'focused';
    this.removeClass('sm-selected').addClass('sm-focused');
    this.refs.editor.enable();
    if (bubbleUp && this.context._parentEditor) {
      this.context._parentEditor._focusEditor(bubbleUp);
    }
    if (bubbleDown) {
      each(this._nestedEditors, function(child) {
        child._blurEditor(false, bubbleDown);
      });
    }
  };

  this._blurEditor = function(bubbleUp, bubbleDown) {
    this.mode = null;
    this.removeClass('sm-focused').removeClass('sm-selected');
    this.refs.editor.disable();
    if (bubbleUp && this.context._parentEditor) {
      this.context._parentEditor._blurEditor(bubbleUp);
    }
    if (bubbleDown) {
      each(this._nestedEditors, function(child) {
        child._blurEditor(false, bubbleDown);
      });
    }
  };

  this.registerSurface = function(surface) {
    console.log('Registering surface "%s" on NestedEditor "%s"', surface.name, this.props.node.id);
    surface.on('surface:focused', this.onSurfaceFocused, this);
    surface.on('surface:blurred', this.onSurfaceBlurred, this);
    if (this.context.surfaceManager) {
      this.context.surfaceManager.registerSurface(surface);
    }
  };

  this.unregisterSurface = function(surface) {
    console.log('Unregistering surface "%s" from NestedEditor "%s"', surface.name, this.props.node.id);
    surface.off(this);
    if (this.context.surfaceManager) {
      this.context.surfaceManager.unregisterSurface(surface);
    }
  };

  this._registerNestedEditor = function(editor) {
    this._nestedEditors[editor.__id__] = editor;
  };

  this._deregisterNestedEditor = function(editor) {
    delete this._nestedEditors[editor.__id__];
  };

};

IsolatedNodeComponent.extend(NestedSurface);

module.exports = NestedSurface;
