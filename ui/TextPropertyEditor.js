'use strict';

var Surface = require('./Surface');
var TextProperty = require('./TextPropertyComponent');

/**
  Editor for a text property (annotated string). Needs to be
  instantiated inside a {@link ui/Controller} context.

  @class
  @component
  @extends ui/Surface

  @prop {String} name unique editor name
  @prop {String[]} path path to a text property
  @prop {ui/SurfaceCommand[]} commands array of command classes to be available

  @example

  Create a `TextPropertyEditor` for the `name` property of an author object. Allow emphasis annotations.

  ```js
  $$(TextPropertyEditor, {
    name: 'authorNameEditor',
    path: ['author_1', 'name'],
    commands: [EmphasisCommand]
  })
  ```
*/

function TextPropertyEditor(parent, props) {
  if (!props.name) {
    props.name = props.path.join('.');
  }
  Surface.apply(this, arguments);
}

TextPropertyEditor.Prototype = function() {

  var _super = TextPropertyEditor.super.prototype;

  this.render = function($$) {
    var el = _super.render.apply(this, arguments);
    el.addClass("sc-text-property-editor");
    el.append(
      $$(TextProperty, {
        tagName: "div",
        path: this.props.path
      })
    );
    if (this.isEditable()) {
      el.attr('contenteditable', true);
    }
    return el;
  };

  this.enable = function() {
    // As opposed to a ContainerEditor, a regular Surface
    // is not a ContentEditable -- but every contained TextProperty
    this.attr('contentEditable', true);
    this.enabled = true;
  };

  this.disable = function() {
    this.removeAttr('contentEditable');
    this.enabled = false;
  };

  this.onMouseDown = function(event) {
    if (this.isEditable()) {
      this.attr('contentEditable', true);
    }
    _super.onMouseDown.call(this, event);
  };

  this.onNativeBlur = function(event) {
    this.attr('contentEditable', false);
    _super.onNativeBlur.call(this, event);
  };

  this.onNativeFocus = function(event) {
    var sel = this.getSelection();
    if (sel && !sel.isNull() && sel.surfaceId === this.name && this.isEditable()) {
      this.attr('contentEditable', true);
    }
    _super.onNativeFocus.call(this, event);
  };

  /**
    Selects all text
  */
  this.selectAll = function() {
    var doc = this.getDocument();
    var path = this.props.path;
    var text = doc.get(path);
    var sel = doc.createSelection({
      type: 'property',
      path: path,
      startOffset: 0,
      endOffset: text.length
    });
    this.setSelection(sel);
  };

};

Surface.extend(TextPropertyEditor);

module.exports = TextPropertyEditor;
