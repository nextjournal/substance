'use strict';

var isString = require('lodash/isString');
var each = require('lodash/each');
var last = require('lodash/last');
var extend = require('lodash/extend');
var uuid = require('../util/uuid');
var keys = require('../util/keys');
var EditingBehavior = require('../model/EditingBehavior');
var insertText = require('../model/transform/insertText');
var copySelection = require('../model/transform/copySelection');
var deleteSelection = require('../model/transform/deleteSelection');
var breakNode = require('../model/transform/breakNode');
var insertNode = require('../model/transform/insertNode');
var switchTextType = require('../model/transform/switchTextType');
var paste = require('../model/transform/paste');
var Surface = require('./Surface');
var RenderingEngine = require('./RenderingEngine');
var IsolatedNodeComponent = require('./IsolatedNodeComponent');
var NestedSurface = require('./NestedSurface');

/**
  Represents a flow editor that manages a sequence of nodes in a container. Needs to be
  instantiated inside a {@link ui/Controller} context.

  @class ContainerEditor
  @component
  @extends ui/Surface

  @prop {String} name unique editor name
  @prop {String} containerId container id
  @prop {Object[]} textTypes array of textType definition objects
  @prop {ui/SurfaceCommand[]} commands array of command classes to be available

  @example

  Create a full-fledged `ContainerEditor` for the `body` container of a document.
  Allow Strong and Emphasis annotations and to switch text types between paragraph
  and heading at level 1.

  ```js
  $$(ContainerEditor, {
    name: 'bodyEditor',
    containerId: 'body',
    textTypes: [
      {name: 'paragraph', data: {type: 'paragraph'}},
      {name: 'heading1',  data: {type: 'heading', level: 1}}
    ],
    commands: [StrongCommand, EmphasisCommand, SwitchTextTypeCommand],
  })
  ```
 */

function ContainerEditor() {
  Surface.apply(this, arguments);

  this.willReceiveProps(this.props);

  this.containerId = this.props.containerId;
  if (!isString(this.props.containerId)) {
    throw new Error("Illegal argument: Expecting containerId.");
  }
  var doc = this.getDocument();
  this.container = doc.get(this.containerId);
  if (!this.container) {
    throw new Error('Container with id ' + this.containerId + ' does not exist.');
  }
  this.editingBehavior = new EditingBehavior();

  this._nestedEditors = {};
}

ContainerEditor.Prototype = function() {

  var _super = Object.getPrototypeOf(this);

  // Note: this component is self managed
  this.shouldRerender = function() {
    // TODO: we should still detect when the document has changed,
    // see https://github.com/substance/substance/issues/543
    return false;
  };

  this.willReceiveProps = function(newProps) {
    _super.willReceiveProps.apply(this, arguments);

    if (!newProps.hasOwnProperty('enabled') || newProps.enabled) {
      this.enabled = true;
    } else {
      this.enabled = false;
    }
  };

  this.render = function($$) {
    var el = _super.render.call(this, $$);

    var doc = this.getDocument();
    var containerId = this.props.containerId;
    var containerNode = doc.get(this.props.containerId);
    if (!containerNode) {
      console.warn('No container node found for ', this.props.containerId);
    }
    el.addClass('sc-container-editor container-node ' + containerId)
      .attr({
        spellCheck: false,
        "data-id": containerId
      });

    if (this.isEmpty()) {
      el.append(
        $$('a').attr('href', '#').append('Start writing').on('click', this.onCreateText)
      );
    } else {
      // node components
      each(containerNode.getNodes(), function(node) {
        el.append(this._renderNode($$, node));
      }.bind(this));
    }

    if (this.enabled) {
      el.attr('contenteditable', true);
    } else {
      el.attr('contenteditable', false);
    }

    return el;
  };

  this._renderNode = function($$, node) {
    if (!node) throw new Error('Illegal argument');
    if (node.isText()) {
      return _super.renderNode.call(this, $$, node);
    } else {
      // TODO: needs more thinking
      var componentRegistry = this.getComponentRegistry();
      var ComponentClass = componentRegistry.get(node.type);
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        return $$(IsolatedNodeComponent, { node: node });
      }
      if (!ComponentClass.static.isContainerEditor && !ComponentClass.static.isPropertyEditor) {
        return $$(IsolatedNodeComponent, { node: node });
      }
      var props = extend({}, this.props);
      props.ComponentClass = ComponentClass;
      // NOTE: surface ids must be hierarchical
      props.name = [this.name, node.id].join('.');
      props.node = node;
      if (ComponentClass.static.isContainerEditor) {
        props.containerId = node.id;
      }
      props.enabled = false;
      return $$(NestedSurface, props);
    }
  };

  this._handleUpOrDownArrowKey = function (event) {
    event.stopPropagation();
    var self = this;
    var direction = (event.keyCode === keys.UP) ? 'left' : 'right';

    var sel = this.getSelection();
    if (sel.isNodeSelection()) {
      this.domSelection.collapse(direction);
    }

    // Note: we need this timeout so that CE updates the DOM selection first
    // before we try to map it to the model
    window.setTimeout(function() {
      if (self._isDisposed()) return;
      var options = {
        direction: direction
      };
      self._updateModelSelection(options);
    });
  };

  this._handleLeftOrRightArrowKey = function (event) {
    event.stopPropagation();
    var self = this;
    var direction = (event.keyCode === keys.LEFT) ? 'left' : 'right';

    var sel = this.getSelection();
    if (sel.isNodeSelection()) {
      this.domSelection.collapse(direction);
    }

    window.setTimeout(function() {
      if (self._isDisposed()) return;
      var options = {
        direction: direction
      };
      self._updateModelSelection(options);
    });
  };


  // Used by Clipboard
  this.isContainerEditor = function() {
    return true;
  };

  /**
    Returns the containerId the editor is bound to
  */
  this.getContainerId = function() {
    return this.props.containerId;
  };

  // TODO: do we really need this in addition to getContainerId?
  this.getContainer = function() {
    return this.getDocument().get(this.getContainerId());
  };

  this.isEmpty = function() {
    var doc = this.getDocument();
    var containerNode = doc.get(this.props.containerId);
    return (containerNode && containerNode.nodes.length === 0);
  };

  this.isEditable = function() {
    return _super.isEditable.call(this) && !this.isEmpty();
  };

  /*
    TODO: Select first content to be found
  */
  this.selectFirst = function() {
    console.warn('TODO: Implement selection of first content to be found.');
  };

  /*
    Register custom editor behavior using this method
  */
  this.extendBehavior = function(extension) {
    extension.register(this.editingBehavior);
  };

  this.getTextTypes = function() {
    return this.textTypes || [];
  };

  // Used by TextTool
  // TODO: Filter by enabled commands for this Surface
  this.getTextCommands = function() {
    var textCommands = {};
    this.commandRegistry.each(function(cmd) {
      if (cmd.constructor.static.textTypeName) {
        textCommands[cmd.getName()] = cmd;
      }
    });
    return textCommands;
  };

  this.enable = function() {
    // As opposed to a ContainerEditor, a regular Surface
    // is not a ContentEditable -- but every contained TextProperty
    this.attr('contenteditable', true);
    this.enabled = true;
  };

  this.disable = function() {
    this.removeAttr('contenteditable');
    this.enabled = false;
  };

  /* Editing behavior */

  /**
    Performs a {@link model/transform/deleteSelection} transformation
  */
  this.delete = function(tx, args) {
    this._prepareArgs(args);
    return deleteSelection(tx, args);
  };

  /**
    Performs a {@link model/transform/breakNode} transformation
  */
  this.break = function(tx, args) {
    this._prepareArgs(args);
    if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
      return breakNode(tx, args);
    }
  };

  /**
    Performs an {@link model/transform/insertNode} transformation
  */
  this.insertNode = function(tx, args) {
    this._prepareArgs(args);
    if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
      return insertNode(tx, args);
    }
  };

  /**
   * Performs a {@link model/transform/switchTextType} transformation
   */
  this.switchType = function(tx, args) {
    this._prepareArgs(args);
    if (args.selection.isPropertySelection()) {
      return switchTextType(tx, args);
    }
  };

  /**
    Selects all content in the container
  */
  this.selectAll = function() {
    var doc = this.getDocument();
    var container = doc.get(this.getContainerId());
    if (container.nodes.length === 0) {
      return;
    }
    var firstNodeId = container.nodes[0];
    var lastNodeId = last(container.nodes);
    var sel = doc.createSelection({
      type: 'container',
      containerId: container.id,
      startPath: [firstNodeId],
      startOffset: 0,
      endPath: [lastNodeId],
      endOffset: 1
    });
    this.setSelection(sel);
  };

  this.selectFirst = function() {
    var doc = this.getDocument();
    var nodes = this.getContainer().nodes;
    if (nodes.length === 0) {
      console.info('ContainerEditor.selectFirst(): Container is empty.');
      return;
    }
    var node = doc.get(nodes[0]);
    var sel;
    if (node.isText()) {
      sel = doc.createSelection(node.getTextPath(), 0);
    } else {
      sel = doc.createSelection(this.getContainerId(), [node.id], 0, [node.id], 1);
    }
    this.setSelection(sel);
  };

  /**
    Performs a {@link model/transform/paste} transformation
  */
  this.paste = function(tx, args) {
    this._prepareArgs(args);
    if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
      return paste(tx, args);
    }
  };

  /**
    Performs an {@link model/transform/insertText} transformation
  */
  this.insertText = function(tx, args) {
    if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
      return insertText(tx, args);
    }
  };

  /**
    Inserts a soft break
  */
  this.softBreak = function(tx, args) {
    args.text = "\n";
    return this.insertText(tx, args);
  };

  /**
    Copy the current selection. Performs a {@link model/transform/copySelection}
    transformation.
  */
  this.copy = function(doc, selection) {
    var result = copySelection(doc, { selection: selection });
    return result.doc;
  };

  this.onDocumentChange = function(change) {
    var doc = this.getDocument();
    // first update the container
    var renderContext = RenderingEngine.createContext(this);
    if (change.isAffected([this.props.containerId, 'nodes'])) {
      for (var i = 0; i < change.ops.length; i++) {
        var op = change.ops[i];
        if (op.type === "update" && op.path[0] === this.props.containerId) {
          var diff = op.diff;
          if (diff.type === "insert") {
            var nodeId = diff.getValue();
            var node = doc.get(nodeId);
            var nodeEl;
            if (node) {
              nodeEl = this._renderNode(renderContext.$$, node);
            } else {
              // node does not exist anymore
              // so we insert a stub element, so that the number of child
              // elements is consistent
              nodeEl = renderContext.$$('div');
            }
            this.insertAt(diff.getOffset(), nodeEl);
          } else if (diff.type === "delete") {
            this.removeAt(diff.getOffset());
          }
        }
      }
    }
    // do other stuff such as rerendering text properties
    _super.onDocumentChange.apply(this, arguments);
  };

  this.onMouseDown = function(event) {
    if (!this.enabled) {
      console.log('ContainerEditor %s is not enabled. Not reacting on mousedown.');
      return;
    }
    if (this.isEditable()) {
      this.attr('contenteditable', true);
    }
    _super.onMouseDown.call(this, event);
  };

  this.onNativeBlur = function(event) {
    this.attr('contenteditable', false);
    _super.onNativeBlur.call(this, event);
  };

  this.onNativeFocus = function(event) {
    var sel = this.getSelection();
    if (sel && !sel.isNull() && sel.surfaceId === this.name && this.isEditable()) {
      this.attr('contenteditable', true);
    }
    _super.onNativeFocus.call(this, event);
  };


  // Create a first text element
  this.onCreateText = function(e) {
    e.preventDefault();

    var newSel;
    this.transaction(function(tx) {
      var container = tx.get(this.props.containerId);
      var textType = tx.getSchema().getDefaultTextType();
      var node = tx.create({
        id: uuid(textType),
        type: textType,
        content: ''
      });
      container.show(node.id);

      newSel = tx.createSelection({
        type: 'property',
        path: [ node.id, 'content'],
        startOffset: 0,
        endOffset: 0
      });
    }.bind(this));
    this.rerender();
    this.setSelection(newSel);
  };

  this._prepareArgs = function(args) {
    args.containerId = this.getContainerId();
    args.editingBehavior = this.editingBehavior;
  };

  this._registerNestedEditor = function(editor) {
    this._nestedEditors[editor.props.node.id] = editor;
  };

  this._deregisterNestedEditor = function(editor) {
    delete this._nestedEditors[editor.props.node.id];
  };

  // EXPERIMENTAL: trying to set the selection into an invisible element
  // so that this surface will still receive ContentEditable events
  this._selectNode = function(nodeId) {
    var nestedEditor = this._nestedEditors[nodeId];
    if (!nestedEditor) {
      console.info('FIXME: selected node is not a nested editor.');
      return;
    }
    var selectedNestedEditor = this._selectedNestedEditor;
    if (selectedNestedEditor) {
      if (selectedNestedEditor.__id__ !== nestedEditor.__id__) {
        selectedNestedEditor._blurEditor(true);
      }
    }
    if (nestedEditor) {
      this._selectedNestedEditor = nestedEditor;
      nestedEditor._select();
      var _selComp = this.refs.selectionHideaway;
      var wsel = window.getSelection();
      if (!this._hiddenSelRange) {
        this._hiddenSelRange = window.document.createRange();
        this._hiddenSelRange.setStart(_selComp.el, 0);
      }
      wsel.removeAllRanges();
      wsel.addRange(this._hiddenSelRange);
    }
  };

};

Surface.extend(ContainerEditor);

ContainerEditor.static.isContainerEditor = true;

module.exports = ContainerEditor;
