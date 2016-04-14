'use strict';

var each = require('lodash/each');
var extend = require('lodash/extend');
var Component = require('./Component');

function NestedSurface() {
  NestedSurface.super.apply(this, arguments);

  // maintaining a set of child editors to be able to propagate
  // focus and blur signals
  this._nestedEditors = {};
}

NestedSurface.Prototype = function() {

  this.getChildContext = function() {
    return {
      // acting as a proxy to the injected surfaceManager
      surfaceManager: this,
      _parentEditor: this,
    };
  };

  this.didMount = function() {
    this.context.documentSession.on('selection:changed', this.onSelectionChange, this);
    this.context.surface._registerNestedEditor(this);
    if (this.context._parentEditor) {
      this.context._parentEditor._registerNestedEditor(this);
    }
  };

  this.dispose = function() {
    this.refs.editor.off(this);
    this.context.documentSession.off(this);
    this.context.surface._deregisterNestedEditor(this);
    if (this.context._parentEditor) {
      this.context._parentEditor._deregisterNestedEditor(this);
    }
  };

  this.render = function($$) {
    var ComponentClass = this.props.ComponentClass;

    var el = $$('div').addClass('sc-nested-surface');
    el.attr('data-id', this.props.node.id);
    // el.attr('contentEditable', false);
    if (this.mode) {
      el.addClass('sm-' + this.mode);
    }
    el.on('mousedown', this.onMousedown);

    el.append(
      $$('div').addClass('se-nested-editor-boundary').addClass('sm-before').ref('before')
        // .attr('contenteditable', false)
        .append('[')
      );

    var container = $$('div').addClass('se-container');
    container.attr('contenteditable', false);

    var editorProps = extend({}, this.props);
    if (!this.mode) {
      editorProps.enabled = false;
    }
    var editor = $$(ComponentClass, editorProps).ref('editor');
    container.append(editor);
    el.append(container);

    el.append(
      $$('div').addClass('se-nested-editor-boundary').addClass('sm-after').ref('after')
      // .attr('contenteditable', false)
      .append(']')
    );

    return el;
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
        return this._select();
      } else {
        this._blurEditor();
      }
    }
  };

  this.onMousedown = function(event) {
    console.log('NestedSurface %s: mousedown', this.props.node.id);
    if (!this.mode) {
      console.log('NestedSurface %s: selecting node', this.props.node.id);
      event.preventDefault();
      event.stopPropagation();
      this._selectNode();
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

  this._selectNode = function() {
    var surface = this.context.surface;
    var doc = surface.getDocument();
    var node = this.props.node;
    surface.setSelection(doc.createSelection({
      type: 'container',
      containerId: surface.getContainerId(),
      startPath: [node.id],
      startOffset: 0,
      endPath: [node.id],
      endOffset: 1
    }));
    this._select();
  };

  this._select = function() {
    this.mode = 'selected';
    this.removeClass('sm-focused').addClass('sm-selected');
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

  this._getCoor = function(which) {
    var el, offset;
    if (which === 'before') {
      el = this.el;
      offset = 0;
    } else {
      el = this.el;
      offset = 3;
    }
    return {
      container: el,
      offset: offset
    };

  };

};

Component.extend(NestedSurface);

NestedSurface.static.isIsolatedNodeComponent = true;

module.exports = NestedSurface;
