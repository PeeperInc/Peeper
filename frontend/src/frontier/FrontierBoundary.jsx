import React from "react";

// Keep the rest of Peeper usable if a scene bundle cannot load on a mobile connection.
export default class FrontierBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("[frontier] scene unavailable", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        role="alert"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          background: "#18271e",
          color: "#eee4c4",
          display: "grid",
          placeContent: "center",
          padding: 28,
          textAlign: "center",
          gap: 16,
        }}
      >
        <h2 style={{ fontFamily: "Georgia,serif" }}>
          The trail is taking a moment.
        </h2>
        <p>Your progress is saved. Reload to download the scene again.</p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload Peeper
        </button>
        <button className="btn" onClick={this.props.onClose}>
          Back to Peeper
        </button>
      </section>
    );
  }
}
