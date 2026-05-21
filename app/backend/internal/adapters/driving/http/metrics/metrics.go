package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	FilesUploaded = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cib_files_uploaded_total",
		Help: "File upload outcomes",
	}, []string{"outcome"})

	ParseDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cib_parse_duration_seconds",
		Help:    "xlsx parse duration",
		Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	})

	CombinedGraphNodes = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "cib_combined_graph_size_nodes",
		Help: "Combined graph node count on last GET /graph",
	})
	CombinedGraphEdges = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "cib_combined_graph_size_edges",
		Help: "Combined graph edge count on last GET /graph",
	})
)
