'use strict';

var Component = require('./Component');

function AbstractIsolatedNodeComponent() {
  Component.apply(this, arguments);
}

AbstractIsolatedNodeComponent.Prototype = function() {

  this.render = function($$) {
    var node = this.props.node;

    var el = $$('div').addClass('sc-isolated-node');
    el.attr("data-id", node.id);

    if (this.state.mode === 'selected') {
      el.addClass('sm-selected');
    } else if (this.state.mode === 'focused') {
      el.addClass('sm-focused');
    }

    var overlay = $$('div').ref('overlay')
      .addClass('se-overlay')
      .on('mousedown', this.onOverlayMousedown);
    el.append(overlay);

    if (this.state.mode === 'focused') {
      el.on('mousedown', this._consumeEvent);
    }

    return el;
  };

  this.setSelection = function(sel, frag) {
    if (sel.isContainerSelection() && !frag.isFull()) {
      this.removeSelection();
    }
    else if (this.state.mode !== 'focused' || !sel.isNodeSelection()) {
      // console.log('AbstractIsolatedNodeComponent: selected.');
      this.setState({
        mode: 'selected',
      });
    }
  };

  this.removeSelection = function() {
    // console.log('AbstractIsolatedNodeComponent: removing selection.');
    this.setState({});
  };

  this._consumeEvent = function(event) {
    event.stopPropagation();
    event.preventDefault();
  };

  this.onOverlayMousedown = function(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.state.mode === "selected") {
      this._focus();
    } else if (this.state.mode === "focused") {
      // nothing
    } else {
      this._select();
    }
  };

  this._select = function() {
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
  };

  this._focus = function() {
    this.extendState({
      mode: 'focused'
    });
  };

};

Component.extend(AbstractIsolatedNodeComponent);

AbstractIsolatedNodeComponent.static.isIsolatedNodeComponent = true;

module.exports = AbstractIsolatedNodeComponent;
