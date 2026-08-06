//! The cancellation tree.
//!
//! ACP's cancellation contract has two halves that are easy to conflate:
//!
//! - **Disconnection is not cancellation.** An explicit signal is required.
//! - **The signal cascades through the request tree.** Cancelling a prompt turn
//!   cancels the tool calls it started and the permission requests those tool
//!   calls raised, and each of those still resolves at the protocol level.
//!
//! This module owns only the topology and the propagation. It has no idea what
//! a session or a tool call is; the dispatcher registers scopes and asks what
//! the cascade reached.

use std::collections::BTreeMap;

use thiserror::Error;

/// A node in the cancellation tree. Opaque and stable for the node's lifetime.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ScopeId(pub String);

impl ScopeId {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl std::fmt::Display for ScopeId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum CancelError {
    #[error("cancellation scope already exists")]
    DuplicateScope,
    #[error("parent cancellation scope does not exist")]
    UnknownParent,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Node {
    parent: Option<ScopeId>,
    children: Vec<ScopeId>,
    cancelled: bool,
}

/// A forest of cancellation scopes, ordered so a cascade is deterministic.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CancelTree {
    nodes: BTreeMap<ScopeId, Node>,
}

impl CancelTree {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a root scope, such as a prompt turn.
    pub fn open_root(&mut self, id: ScopeId) -> Result<(), CancelError> {
        self.insert(id, None)
    }

    /// Open a scope beneath `parent`. A child opened under an already-cancelled
    /// parent is born cancelled, so a late registration cannot escape a cascade
    /// that already passed.
    pub fn open_child(&mut self, parent: &ScopeId, id: ScopeId) -> Result<(), CancelError> {
        if !self.nodes.contains_key(parent) {
            return Err(CancelError::UnknownParent);
        }
        self.insert(id.clone(), Some(parent.clone()))?;
        let inherited = self.is_cancelled(parent);
        if let Some(node) = self.nodes.get_mut(&id) {
            node.cancelled = inherited;
        }
        if let Some(node) = self.nodes.get_mut(parent) {
            node.children.push(id);
        }
        Ok(())
    }

    fn insert(&mut self, id: ScopeId, parent: Option<ScopeId>) -> Result<(), CancelError> {
        if self.nodes.contains_key(&id) {
            return Err(CancelError::DuplicateScope);
        }
        self.nodes.insert(
            id,
            Node {
                parent,
                children: Vec::new(),
                cancelled: false,
            },
        );
        Ok(())
    }

    #[must_use]
    pub fn contains(&self, id: &ScopeId) -> bool {
        self.nodes.contains_key(id)
    }

    #[must_use]
    pub fn is_cancelled(&self, id: &ScopeId) -> bool {
        self.nodes.get(id).is_some_and(|node| node.cancelled)
    }

    #[must_use]
    pub fn parent(&self, id: &ScopeId) -> Option<&ScopeId> {
        self.nodes.get(id).and_then(|node| node.parent.as_ref())
    }

    /// The root of `id`'s tree, or `None` when `id` is unknown.
    #[must_use]
    pub fn root_of(&self, id: &ScopeId) -> Option<ScopeId> {
        let mut current = self.nodes.get_key_value(id)?.0.clone();
        // The tree is built parent-first, so the walk terminates; the bound is
        // a belt-and-braces guard against a cycle introduced by a future edit.
        for _ in 0..self.nodes.len().saturating_add(1) {
            match self
                .nodes
                .get(&current)
                .and_then(|node| node.parent.clone())
            {
                Some(parent) => current = parent,
                None => return Some(current),
            }
        }
        Some(current)
    }

    /// Cancel `id` and everything beneath it.
    ///
    /// Returns the scopes this call newly cancelled, parent before child, so a
    /// caller can emit terminal frames in an order a client can apply. A scope
    /// already cancelled contributes nothing, which makes the operation
    /// idempotent: a duplicate `session/cancel` does not re-emit terminals.
    pub fn cancel(&mut self, id: &ScopeId) -> Vec<ScopeId> {
        let mut newly = Vec::new();
        let mut queue = vec![id.clone()];
        while let Some(current) = queue.pop() {
            let Some(node) = self.nodes.get_mut(&current) else {
                continue;
            };
            let children = node.children.clone();
            if !node.cancelled {
                node.cancelled = true;
                newly.push(current);
            }
            // Descend even through an already-cancelled node: a child opened
            // before its parent was cancelled by a different path may still be
            // live.
            queue.extend(children.into_iter().rev());
        }
        newly
    }

    /// Drop `id` and its whole subtree. Used when work finishes normally, so
    /// the tree does not grow without bound over a long-lived connection.
    pub fn close(&mut self, id: &ScopeId) {
        let mut queue = vec![id.clone()];
        let mut removed = Vec::new();
        while let Some(current) = queue.pop() {
            if let Some(node) = self.nodes.remove(&current) {
                queue.extend(node.children);
                removed.push(current);
            }
        }
        for id in &removed {
            if let Some(parent) = self
                .nodes
                .values_mut()
                .find(|node| node.children.contains(id))
            {
                parent.children.retain(|child| child != id);
            }
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(name: &str) -> ScopeId {
        ScopeId::new(name)
    }

    fn tree() -> CancelTree {
        let mut tree = CancelTree::new();
        tree.open_root(scope("turn")).expect("root");
        tree.open_child(&scope("turn"), scope("tool-a"))
            .expect("tool");
        tree.open_child(&scope("turn"), scope("tool-b"))
            .expect("tool");
        tree.open_child(&scope("tool-a"), scope("perm-1"))
            .expect("perm");
        tree
    }

    #[test]
    fn cancelling_a_root_cascades_to_every_descendant() {
        let mut tree = tree();
        let newly = tree.cancel(&scope("turn"));
        assert_eq!(newly.len(), 4, "{newly:?}");
        assert_eq!(
            newly.first(),
            Some(&scope("turn")),
            "parent precedes children"
        );
        for name in ["turn", "tool-a", "tool-b", "perm-1"] {
            assert!(
                tree.is_cancelled(&scope(name)),
                "{name} escaped the cascade"
            );
        }
    }

    #[test]
    fn cancelling_a_branch_leaves_its_siblings_running() {
        let mut tree = tree();
        tree.cancel(&scope("tool-a"));
        assert!(tree.is_cancelled(&scope("tool-a")));
        assert!(tree.is_cancelled(&scope("perm-1")));
        assert!(!tree.is_cancelled(&scope("tool-b")));
        assert!(!tree.is_cancelled(&scope("turn")));
    }

    #[test]
    fn cancellation_is_idempotent_so_terminals_are_emitted_once() {
        let mut tree = tree();
        assert_eq!(tree.cancel(&scope("turn")).len(), 4);
        assert!(tree.cancel(&scope("turn")).is_empty());
    }

    #[test]
    fn a_scope_opened_under_a_cancelled_parent_is_born_cancelled() {
        let mut tree = tree();
        tree.cancel(&scope("turn"));
        tree.open_child(&scope("tool-b"), scope("late"))
            .expect("late child");
        assert!(tree.is_cancelled(&scope("late")));
    }

    #[test]
    fn scopes_report_their_root_and_close_as_a_subtree() {
        let mut tree = tree();
        assert_eq!(tree.root_of(&scope("perm-1")), Some(scope("turn")));
        tree.close(&scope("tool-a"));
        assert!(!tree.contains(&scope("tool-a")));
        assert!(!tree.contains(&scope("perm-1")));
        assert!(tree.contains(&scope("tool-b")));
        tree.close(&scope("turn"));
        assert!(tree.is_empty());
    }

    #[test]
    fn duplicate_and_orphan_scopes_are_refused() {
        let mut tree = tree();
        assert_eq!(
            tree.open_root(scope("turn")),
            Err(CancelError::DuplicateScope)
        );
        assert_eq!(
            tree.open_child(&scope("absent"), scope("x")),
            Err(CancelError::UnknownParent)
        );
    }
}
