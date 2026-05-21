package casedom

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type CaseStatus string

const (
	StatusOpen     CaseStatus = "open"
	StatusClosed   CaseStatus = "closed"
	StatusArchived CaseStatus = "archived"
)

func (s CaseStatus) Valid() bool {
	switch s {
	case StatusOpen, StatusClosed, StatusArchived:
		return true
	}
	return false
}

type Case struct {
	ID        uuid.UUID
	Title     string
	Notes     string
	Tags      []string
	Status    CaseStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

var (
	ErrTitleRequired = errors.New("case: title is required")
	ErrBadStatus     = errors.New("case: invalid status")
)

func NewCase(title, notes string, tags []string) (Case, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return Case{}, ErrTitleRequired
	}
	now := time.Now().UTC()
	if tags == nil {
		tags = []string{}
	}
	return Case{
		ID:        uuid.New(),
		Title:     t,
		Notes:     notes,
		Tags:      tags,
		Status:    StatusOpen,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func (c *Case) SetTitle(title string) error {
	t := strings.TrimSpace(title)
	if t == "" {
		return ErrTitleRequired
	}
	c.Title = t
	c.UpdatedAt = time.Now().UTC()
	return nil
}

func (c *Case) SetNotes(notes string) {
	c.Notes = notes
	c.UpdatedAt = time.Now().UTC()
}

func (c *Case) SetTags(tags []string) {
	if tags == nil {
		tags = []string{}
	}
	c.Tags = tags
	c.UpdatedAt = time.Now().UTC()
}

func (c *Case) SetStatus(s CaseStatus) error {
	if !s.Valid() {
		return ErrBadStatus
	}
	c.Status = s
	c.UpdatedAt = time.Now().UTC()
	return nil
}

func (c *Case) Archive() {
	c.Status = StatusArchived
	c.UpdatedAt = time.Now().UTC()
}

type CaseFilters struct {
	TitleSubstring string
	Tags           []string
	Statuses       []CaseStatus
	CreatedFrom    *time.Time
	CreatedTo      *time.Time
}
