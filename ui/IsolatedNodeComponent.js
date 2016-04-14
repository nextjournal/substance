'use strict';

var AbstractIsolatedNodeComponent = require('./AbstractIsolatedNodeComponent');
var Surface = require('./Surface');

function IsolatedNodeComponent() {
  IsolatedNodeComponent.super.apply(this, arguments);
}

IsolatedNodeComponent.Prototype = function() {

  var _super = Object.getPrototypeOf(this);

  this.render = function() {
    var el = _super.render.call(this);

    var node = this.props.node;
    el.addClass('sc-isolated-node')
      .attr("data-id", node.id)
      .attr("contenteditable", false);

    var surface = this.context.surface;
    el.append(Surface.prototype.renderNode.call(surface, this.props.node));

    return el;
  };

  this._focus = function() {
    _super._focus.call(this);
    this._select();
  };

};

AbstractIsolatedNodeComponent.extend(IsolatedNodeComponent);

module.exports = IsolatedNodeComponent;
