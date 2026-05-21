package casedom

import (
	"testing"
)

func TestNewCase_TitleRequired(t *testing.T) {
	if _, err := NewCase("", "", nil); err == nil {
		t.Fatal("expected error for empty title")
	}
	if _, err := NewCase("   ", "", nil); err == nil {
		t.Fatal("expected error for whitespace-only title")
	}
}

func TestNewCase_DefaultsOpen(t *testing.T) {
	c, err := NewCase("ACME fraud", "notes", []string{"fraud"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Status != StatusOpen {
		t.Fatalf("want open, got %s", c.Status)
	}
	if c.Title != "ACME fraud" {
		t.Fatalf("want trimmed title, got %q", c.Title)
	}
	if len(c.Tags) != 1 || c.Tags[0] != "fraud" {
		t.Fatalf("want tags=[fraud], got %v", c.Tags)
	}
}

func TestArchive(t *testing.T) {
	c, _ := NewCase("x", "", nil)
	c.Archive()
	if c.Status != StatusArchived {
		t.Fatalf("want archived, got %s", c.Status)
	}
}

func TestSetStatus_RejectsInvalid(t *testing.T) {
	c, _ := NewCase("x", "", nil)
	if err := c.SetStatus("bogus"); err == nil {
		t.Fatal("expected error")
	}
	if err := c.SetStatus(StatusClosed); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSetTitle_Trims(t *testing.T) {
	c, _ := NewCase("x", "", nil)
	if err := c.SetTitle("  new  "); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Title != "new" {
		t.Fatalf("want trimmed, got %q", c.Title)
	}
}
