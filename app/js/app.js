'use strict';

import * as threads from 'components/threads/threads';
import * as d3 from 'components/d3/d3.min';
import /*global isNumber*/ 'components/node-isnumber/index';
import /*global stats*/ 'components/node-stats-lite/stats';

threads.manager({
  'latency-service': {
    src: 'workers/service.js',
    type: 'worker'
  }
});

const ITERATIONS = 100;

var app = {
  client: threads.client('latency-service'),
  rawWorker: new Worker('workers/worker.js'),
  channel: 'BroadcastChannel' in window ? new BroadcastChannel('latency') : {},

  elements: {
    reload: document.getElementById('reload'),
    table: document.getElementById('table'),
    barchart: document.getElementById('barchart'),
    scatterplot: document.getElementById('scatterplot')
  },

  graph: {},

  init: function() {
    this.rawWorker.postMessage(0);
    this.rawWorker.onmessage = () => {
      // The web worker is ready.
      this.rawWorker.onmessage = null;

      setTimeout(() => {
        this.startMeasuring();
      }, 500);
    };

    this.elements.reload.addEventListener('click', () => {
      this.startMeasuring();
    });
  },

  startMeasuring: function() {
    this.elements.table.innerHTML = '';
    this.initBarChart();
    this.initScatterPlot();

    this.measureLatencyOfThreads([]);
    this.measureLatencyOfWebWorkersWithPostMessage([]);
    this.measureLatencyOfWebWorkersWithBroadcastChannel([]);
  },

  measureLatencyOfThreads: function(values) {
    var now = Date.now();
    var highResolutionBefore = performance.now();

    this.client
      .call('ping', now)
      .then(timestamps => {
        var now = Date.now();
        var highResolutionAfter = performance.now();
        var value = [
          timestamps[0],
          now - timestamps[1],
          highResolutionAfter - highResolutionBefore
        ];

        values.push(value);

        if (values.length <= ITERATIONS) {
          this.measureLatencyOfThreads(values);
        } else {
          this.processData('threads library', values,
            'threads');
        }
      });
  },

  measureLatencyOfWebWorkersWithPostMessage: function(values) {
    var now = Date.now();
    var highResolutionBefore = performance.now();

    this.rawWorker.postMessage(now);
    this.rawWorker.onmessage = evt => {
      var timestamps = evt.data;
      var now = Date.now();
      var highResolutionAfter = performance.now();
      var value = [
        timestamps[0],
        now - timestamps[1],
        highResolutionAfter - highResolutionBefore
      ];

      values.push(value);

      if (values.length <= ITERATIONS) {
        this.measureLatencyOfWebWorkersWithPostMessage(values);
      } else {
        this.processData('Web Workers with postMessage', values,
          'postMessage');
      }
    };
  },

  measureLatencyOfWebWorkersWithBroadcastChannel: function(values) {
    if (!BroadcastChannel) {
      // Not all browsers implement the BroadcastChannel API.
      return;
    }

    var now = Date.now();
    var highResolutionBefore = performance.now();

    this.channel.postMessage(now);
    this.channel.onmessage = evt => {
      var timestamps = evt.data;
      var now = Date.now();
      var highResolutionAfter = performance.now();
      var value = [
        timestamps[0],
        now - timestamps[1],
        highResolutionAfter - highResolutionBefore
      ];

      values.push(value);

      if (values.length <= ITERATIONS) {
        this.measureLatencyOfWebWorkersWithBroadcastChannel(values);
      } else {
        this.processData('Web Workers with Broadcast Channel', values,
          'BC channel');
      }
    };
  },

  processData: function(title, values, shortTitle) {
    values.shift(); // Remove the first measure.

    var uploadVal = values.map(value => value[0]);
    var downloadVal = values.map(value => value[1]);
    var roundtripVal = values.map(value => value[2]);

    var uploadMean = mean(uploadVal);
    var downloadMean = mean(downloadVal);
    var roundtripMean = mean(roundtripVal);
    var uploadMedian = median(uploadVal);
    var downloadMedian = median(downloadVal);
    var roundtripMedian = median(roundtripVal);
    var uploadStdev = stdev(uploadVal);
    var downloadStdev = stdev(downloadVal);
    var roundtripStdev = stdev(roundtripVal);
    var upload90Percentile = percentile(uploadVal, .90);
    var download90Percentile = percentile(downloadVal, .90);
    var roundtrip90Percentile = percentile(roundtripVal, .90);
    var upload95Percentile = percentile(uploadVal, .95);
    var download95Percentile = percentile(downloadVal, .95);
    var roundtrip95Percentile = percentile(roundtripVal, .95);

    var tpl = `
        <header>
          <h2>${title}</h2>
        </header>
        <table>
          <tr>
            <th></th>
            <th>Mean</th>
            <th>Median</th>
            <th>Std dev</th>
            <th>90th %ile</th>
            <th>95th %ile</th>
          </tr>
          <tr>
            <th>U</th>
            <td>${(uploadMean).toFixed(3)}</td>
            <td>${(uploadMedian).toFixed(3)}</td>
            <td>${(uploadStdev).toFixed(3)}</td>
            <td>${(upload90Percentile).toFixed(3)}</td>
            <td>${(upload95Percentile).toFixed(3)}</td>
          </tr>
          <tr>
            <th>D</th>
            <td>${(downloadMean).toFixed(3)}</td>
            <td>${(downloadMedian).toFixed(3)}</td>
            <td>${(downloadStdev).toFixed(3)}</td>
            <td>${(download90Percentile).toFixed(3)}</td>
            <td>${(download95Percentile).toFixed(3)}</td>
          </tr>
          <tr>
            <th>RT</th>
            <td>${(roundtripMean).toFixed(3)}</td>
            <td>${(roundtripMedian).toFixed(3)}</td>
            <td>${(roundtripStdev).toFixed(3)}</td>
            <td>${(roundtrip90Percentile).toFixed(3)}</td>
            <td>${(roundtrip95Percentile).toFixed(3)}</td>
          </tr>
        </table>
      `;

    var container = document.createElement('div');
    container.innerHTML = tpl;
    this.elements.table.appendChild(container);

    this.plotBarChart([
      {name: 'x', value: roundtripMean},
      {name: 'M', value: roundtripMedian},
      {name: '90%', value: roundtrip90Percentile},
      {name: '95%', value: roundtrip95Percentile}
    ], shortTitle);

    this.plotScatter(values.map((value, index) => {
      return {
        name: shortTitle,
        value: value[2],
        id: index
      };
    }));
  },

  // Graph related methods.
  initBarChart: function() {
    this.elements.barchart.innerHTML = '';

    this.graph.g = {};
    this.graph.g.margin = {top: 5, right: 45, bottom: 30, left: 30};
    this.graph.g.width = 320 - this.graph.g.margin.left - this.graph.g.margin.right;
    this.graph.g.height = 240 - this.graph.g.margin.top - this.graph.g.margin.bottom;

    this.graph.g.x = d3.scale.ordinal()
      .rangeRoundBands([0, this.graph.g.width], .1);

    this.graph.g.y = d3.scale.linear()
      .domain([0, this.graph.g.maxY])
      .range([this.graph.g.height, 0]);

    this.graph.g.xAxis = d3.svg.axis()
      .scale(this.graph.g.x)
      .orient('bottom');

    this.graph.g.yAxis = d3.svg.axis()
      .scale(this.graph.g.y)
      .orient('left');

    this.graph.g.color = d3.scale.category10();

    this.graph.g.chart = d3.select('#barchart').append('svg')
      .attr('width', this.graph.g.width + this.graph.g.margin.left + this.graph.g.margin.right)
      .attr('height', this.graph.g.height + this.graph.g.margin.top + this.graph.g.margin.bottom).append('g')
      .attr('transform', `translate(${this.graph.g.margin.left},${this.graph.g.margin.top})`);

    this.graph.g.xAxisEl = this.graph.g.chart.append('g')
      .attr('class', 'x axis')
      .attr('transform', `translate(0,${this.graph.g.height})`);

    this.graph.g.yAxisEl = this.graph.g.chart.append('g')
      .attr('class', 'y axis');

    this.graph.g.yAxisEl
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 6)
      .attr('dy', '.71em')
      .style('text-anchor', 'end')
      .text('Latency in ms');

    this.graph.g.maxY = 0;
    this.graph.g.set = 0;
    this.graph.g.data = [];
  },

  plotBarChart: function(data, title) {
    if (this.graph.g.set === 1) {
      this.graph.g.x.domain(data.map(d => d.name));

      // Captions for the different statistic functions plotted.
      var caption = this.graph.g.chart.append('g')
        .attr('class', 'caption')
        .attr('transform', `translate(${this.graph.g.margin.right},0)`);

      var legend = caption.selectAll('.legend')
        .data(data)
        .enter().append('g')
        .attr('class', 'legend')
        .attr('transform', (d, i) => `translate(0,${(i * 20)})`);

      legend.append('rect')
        .attr('x', this.graph.g.width - 18)
        .attr('width', 18)
        .attr('height', 18)
        .style('fill', d => this.graph.g.color(d.name));

      legend.append('text')
        .attr('x', this.graph.g.width - 24)
        .attr('y', 9)
        .attr('dy', '.35em')
        .style('text-anchor', 'end')
        .text(d => d.name);
    }

    data.forEach(item => item.name += ` ${this.graph.g.set} `);

    this.graph.g.data = this.graph.g.data.concat(data);

    // Caption for each measured set.
    this.graph.g.xAxisEl
      .append('text')
      .attr('transform', `translate(${(this.graph.g.set * this.graph.g.width / 3)},12)`)
      .attr('y', 6)
      .attr('dy', '.71em')
      .text(` ${title} `);

    this.graph.g.set++;

    if (this.graph.g.set < 3) {
      return;
    }

    this.graph.g.maxY = d3.max(this.graph.g.data, d => d.value);

    this.graph.g.x.domain(this.graph.g.data.map(d => d.name));
    this.graph.g.y.domain([0, this.graph.g.maxY]);

    this.graph.g.xAxisEl.call(this.graph.g.xAxis);
    this.graph.g.yAxisEl.call(this.graph.g.yAxis);

    this.graph.g.chart.selectAll('.bar')
      .data(this.graph.g.data)
      .enter().append('rect')
      .attr('class', 'bar')
      .attr('x', d => this.graph.g.x(d.name))
      .attr('y', d => this.graph.g.y(d.value))
      .attr('height', d => this.graph.g.height - this.graph.g.y(d.value))
      .attr('width', this.graph.g.x.rangeBand())
      .style('fill', d => this.graph.g.color(d.name.split(' ')[0]));
  },

  initScatterPlot: function() {
    this.elements.scatterplot.innerHTML = '';

    this.graph.s = {};
    this.graph.s.margin = {top: 5, right: 5, bottom: 30, left: 30};
    this.graph.s.width = 320 - this.graph.s.margin.left - this.graph.s.margin.right;
    this.graph.s.height = 240 - this.graph.s.margin.top - this.graph.s.margin.bottom;

    this.graph.s.x = d3.scale.linear()
      .domain([0, ITERATIONS])
      .range([0, this.graph.s.width]);

    this.graph.s.y = d3.scale.linear()
      .domain([0, 1])
      .range([this.graph.s.height, 0]);

    this.graph.s.xAxis = d3.svg.axis()
      .scale(this.graph.s.x)
      .orient('bottom');

    this.graph.s.yAxis = d3.svg.axis()
      .scale(this.graph.s.y)
      .orient('left');

    this.graph.s.color = d3.scale.category10();

    this.graph.s.chart = d3.select('#scatterplot').append('svg')
      .attr('width', this.graph.s.width + this.graph.s.margin.left + this.graph.s.margin.right)
      .attr('height', this.graph.s.height + this.graph.s.margin.top + this.graph.s.margin.bottom).append('g')
      .attr('transform', `translate(${this.graph.s.margin.left},${this.graph.s.margin.top})`);

    this.graph.s.xAxisEl = this.graph.s.chart.append('g')
      .attr('class', 'x axis')
      .attr('transform', `translate(0,${this.graph.s.height})`);

    this.graph.s.yAxisEl = this.graph.s.chart.append('g')
      .attr('class', 'y axis');

    this.graph.s.xAxisEl
      .append('text')
      .attr('x', this.graph.s.width)
      .attr('y', 0)
      .style('text-anchor', 'end')
      .text('Measure');

    this.graph.s.yAxisEl
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 6)
      .attr('dy', '.71em')
      .style('text-anchor', 'end')
      .text('Latency in ms');

    this.graph.s.maxY = 0;
    this.graph.s.set = 0;
    this.graph.s.data = [];
  },

  plotScatter: function(data) {
    this.graph.s.data = this.graph.s.data.concat(data);

    this.graph.s.set++;

    if (this.graph.s.set < 3) {
      return;
    }

    this.graph.s.maxY = d3.max(this.graph.s.data, d => d.value);

    this.graph.s.y.domain([0, this.graph.s.maxY]);

    this.graph.s.xAxisEl.call(this.graph.s.xAxis);
    this.graph.s.yAxisEl.call(this.graph.s.yAxis);

    this.graph.s.chart.selectAll('.dot')
      .data(this.graph.s.data)
      .enter().append('circle')
      .attr('class', 'dot')
      .attr('r', 2)
      .attr('cx', d => this.graph.s.x(d.id))
      .attr('cy', d => this.graph.s.y(d.value))
      .style('fill', d => this.graph.s.color(d.name));

    var legend = this.graph.s.chart.selectAll('.legend')
      .data(this.graph.s.color.domain())
      .enter().append('g')
      .attr('class', 'legend')
      .attr('transform', (d, i) => `translate(0,${(i * 20)})`);

    legend.append('rect')
      .attr('x', this.graph.s.width - 18)
      .attr('width', 18)
      .attr('height', 18)
      .style('fill', this.graph.s.color);

    legend.append('text')
      .attr('x', this.graph.s.width - 24)
      .attr('y', 9)
      .attr('dy', '.35em')
      .style('text-anchor', 'end')
      .text(d => d);
  }
};

app.init();