//! Directory descriptors pinned for the length of one Land entry.
//!
//! Land decides a path is safe, then writes to it. Between those two moments a
//! name can be re-pointed by any process running as the same user, and every
//! path-based call re-resolves the name from scratch — so the check and the
//! write can be about two different directories. Resolving once into a
//! descriptor and issuing every later operation through that descriptor removes
//! the window: the descriptor names the directory itself, not a route to it.
//!
//! `changeloop-snapshot` already restores this way. This module gives Land the
//! same guarantee over the operations Land actually performs.

use crate::{LandError, PathIdentity};
use std::path::{Component, Path, PathBuf};

/// A directory Land holds open, plus the leaf name inside it that an entry
/// refers to.
#[derive(Debug)]
pub(crate) struct PinnedEntry {
    #[cfg(unix)]
    directory: std::fs::File,
    #[cfg(unix)]
    name: std::ffi::CString,
    /// The path this entry resolved from, for error reporting only. It is never
    /// re-resolved.
    display: PathBuf,
    #[cfg(not(unix))]
    path: PathBuf,
}

fn safe_components(relative: &Path) -> Result<Vec<&std::ffi::OsStr>, LandError> {
    let mut names = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => names.push(value),
            Component::CurDir => {}
            _ => return Err(LandError::UnsafePath(relative.into())),
        }
    }
    if names.is_empty() {
        return Err(LandError::UnsafePath(relative.into()));
    }
    Ok(names)
}

#[cfg(unix)]
mod imp {
    use super::{LandError, PathIdentity, PinnedEntry, safe_components};
    use sha2::{Digest as _, Sha256};
    use std::ffi::CString;
    use std::fs::File;
    use std::io::Read;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    const DIRECTORY_FLAGS: libc::c_int =
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

    fn open_root(root: &Path) -> Result<File, LandError> {
        let name = CString::new(root.as_os_str().as_bytes())
            .map_err(|_| LandError::UnsafePath(root.into()))?;
        // SAFETY: `name` is a NUL-terminated path owned for the call, and the
        // returned descriptor is immediately adopted by `File`.
        let descriptor = unsafe { libc::open(name.as_ptr(), DIRECTORY_FLAGS) };
        if descriptor < 0 {
            return Err(LandError::Io(std::io::Error::last_os_error()));
        }
        // SAFETY: `descriptor` is a fresh, owned, non-negative descriptor.
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    fn open_child_directory(
        parent: &File,
        name: &CString,
        create: bool,
        relative: &Path,
    ) -> Result<File, LandError> {
        // SAFETY: the descriptor is borrowed for the call and `name` is
        // NUL-terminated.
        let mut descriptor =
            unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), DIRECTORY_FLAGS) };
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound && create {
                // SAFETY: same borrow and NUL-termination as above.
                let created = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
                if created < 0
                    && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
                {
                    return Err(LandError::Io(std::io::Error::last_os_error()));
                }
                // SAFETY: as above.
                descriptor =
                    unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), DIRECTORY_FLAGS) };
            }
        }
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            // A component that is a symlink, or anything but a directory, is
            // refused rather than followed.
            return if error.raw_os_error() == Some(libc::ELOOP)
                || error.raw_os_error() == Some(libc::ENOTDIR)
            {
                Err(LandError::UnsupportedPath(relative.into()))
            } else {
                Err(LandError::Io(error))
            };
        }
        // SAFETY: `descriptor` is a fresh, owned, non-negative descriptor.
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    impl PinnedEntry {
        /// Resolves `relative` under `root` into a held directory descriptor and
        /// a leaf name. Every component is opened with `O_NOFOLLOW`, so a
        /// symlink anywhere on the way is refused rather than traversed.
        pub(crate) fn resolve(
            root: &Path,
            relative: &Path,
            create_parents: bool,
        ) -> Result<Self, LandError> {
            let names = safe_components(relative)?;
            let (leaf, parents) = names
                .split_last()
                .ok_or_else(|| LandError::UnsafePath(relative.into()))?;
            let mut directory = open_root(root)?;
            for component in parents {
                let name = CString::new(component.as_bytes())
                    .map_err(|_| LandError::UnsafePath(relative.into()))?;
                directory = open_child_directory(&directory, &name, create_parents, relative)?;
            }
            Ok(Self {
                directory,
                name: CString::new(leaf.as_bytes())
                    .map_err(|_| LandError::UnsafePath(relative.into()))?,
                display: root.join(relative),
            })
        }

        #[allow(dead_code)]
        pub(crate) fn display(&self) -> &Path {
            &self.display
        }

        /// Opens the leaf without following a symlink and returns its content
        /// identity, or `Missing`. A non-regular or multiply-linked leaf is
        /// refused, matching the path-based rule this replaces.
        pub(crate) fn identity(&self) -> Result<PathIdentity, LandError> {
            // SAFETY: borrowed descriptor, NUL-terminated name.
            let descriptor = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    self.name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            };
            if descriptor < 0 {
                let error = std::io::Error::last_os_error();
                return match error.kind() {
                    std::io::ErrorKind::NotFound => Ok(PathIdentity::Missing),
                    _ if error.raw_os_error() == Some(libc::ELOOP) => {
                        Err(LandError::UnsupportedPath(self.display.clone()))
                    }
                    _ => Err(LandError::Io(error)),
                };
            }
            // SAFETY: fresh owned descriptor.
            let mut file = unsafe { File::from_raw_fd(descriptor) };
            let metadata = file.metadata()?;
            if !metadata.file_type().is_file() {
                return Err(LandError::UnsupportedPath(self.display.clone()));
            }
            {
                use std::os::unix::fs::MetadataExt as _;
                if metadata.nlink() != 1 {
                    return Err(LandError::UnsupportedPath(self.display.clone()));
                }
            }
            let mut digest = Sha256::new();
            let mut bytes = 0_u64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                digest.update(&buffer[..read]);
                bytes = bytes.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
            }
            use std::os::unix::fs::PermissionsExt as _;
            Ok(PathIdentity::File {
                sha256: format!("{:x}", digest.finalize()),
                bytes,
                executable: metadata.permissions().mode() & 0o111 != 0,
            })
        }

        /// Unlinks the leaf if it is a regular file. Absent is success;
        /// anything else is refused.
        pub(crate) fn remove_regular_if_exists(&self) -> Result<(), LandError> {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
            // SAFETY: borrowed descriptor, NUL-terminated name, and `stat` is
            // only read after a successful call reports it initialized.
            let statted = unsafe {
                libc::fstatat(
                    self.directory.as_raw_fd(),
                    self.name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if statted < 0 {
                let error = std::io::Error::last_os_error();
                return if error.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(LandError::Io(error))
                };
            }
            // SAFETY: `fstatat` returned success, so `stat` is initialized.
            let mode = unsafe { stat.assume_init() }.st_mode;
            if mode & libc::S_IFMT != libc::S_IFREG {
                return Err(LandError::UnsupportedPath(self.display.clone()));
            }
            // SAFETY: borrowed descriptor, NUL-terminated name.
            if unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0) } < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(LandError::Io(error));
                }
            }
            Ok(())
        }

        /// Stages `source` beside the leaf inside the pinned directory and
        /// renames it over the leaf. Staging in the destination directory is
        /// what makes the publishing rename same-directory and atomic; a
        /// cross-directory rename would resolve the destination parent by name
        /// again, which is the window this module exists to close.
        pub(crate) fn replace_with(
            &self,
            source: &mut File,
            executable: bool,
            temporary_suffix: &str,
        ) -> Result<(), LandError> {
            let temporary = CString::new(format!(".changeloop-land-{temporary_suffix}.tmp"))
                .map_err(|_| LandError::UnsafePath(self.display.clone()))?;
            // SAFETY: borrowed descriptor, NUL-terminated name; O_EXCL means a
            // pre-existing entry is an error rather than a target.
            let descriptor = unsafe {
                libc::openat(
                    self.directory.as_raw_fd(),
                    temporary.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if descriptor < 0 {
                return Err(LandError::Io(std::io::Error::last_os_error()));
            }
            // SAFETY: fresh owned descriptor.
            let mut staged = unsafe { File::from_raw_fd(descriptor) };
            let published = (|| -> std::io::Result<()> {
                std::io::copy(source, &mut staged)?;
                use std::os::unix::fs::PermissionsExt as _;
                staged.set_permissions(std::fs::Permissions::from_mode(if executable {
                    0o755
                } else {
                    0o644
                }))?;
                staged.sync_all()?;
                // SAFETY: both descriptors are borrowed and both names are
                // NUL-terminated.
                let renamed = unsafe {
                    libc::renameat(
                        self.directory.as_raw_fd(),
                        temporary.as_ptr(),
                        self.directory.as_raw_fd(),
                        self.name.as_ptr(),
                    )
                };
                if renamed < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                self.directory.sync_all()
            })();
            if let Err(error) = published {
                // SAFETY: borrowed descriptor, NUL-terminated name.
                unsafe {
                    libc::unlinkat(self.directory.as_raw_fd(), temporary.as_ptr(), 0);
                }
                return Err(LandError::Io(error));
            }
            Ok(())
        }
    }
}

#[cfg(not(unix))]
mod imp {
    use super::{LandError, PathIdentity, PinnedEntry, safe_components};
    use std::fs::File;
    use std::path::Path;

    impl PinnedEntry {
        /// Path-based fallback. Descriptor pinning needs the `*at` family, so
        /// on this target Land keeps its previous behaviour and its previous
        /// exposure; the Unix targets are the ones the sandbox supports.
        pub(crate) fn resolve(
            root: &Path,
            relative: &Path,
            create_parents: bool,
        ) -> Result<Self, LandError> {
            let names = safe_components(relative)?;
            let mut path = root.to_path_buf();
            for component in &names[..names.len().saturating_sub(1)] {
                path.push(component);
                match std::fs::symlink_metadata(&path) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err(LandError::UnsupportedPath(root.join(relative)));
                    }
                    Ok(metadata) if metadata.is_dir() => {}
                    Ok(_) => return Err(LandError::UnsupportedPath(root.join(relative))),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        if !create_parents {
                            break;
                        }
                        std::fs::create_dir(&path)?;
                    }
                    Err(error) => return Err(LandError::Io(error)),
                }
            }
            Ok(Self {
                display: root.join(relative),
                path: root.join(relative),
            })
        }

        #[allow(dead_code)]
        pub(crate) fn display(&self) -> &Path {
            &self.display
        }

        pub(crate) fn identity(&self) -> Result<PathIdentity, LandError> {
            crate::identity(&self.path)
        }

        pub(crate) fn remove_regular_if_exists(&self) -> Result<(), LandError> {
            crate::remove_regular_if_exists(&self.path)
        }

        pub(crate) fn replace_with(
            &self,
            source: &mut File,
            executable: bool,
            _temporary_suffix: &str,
        ) -> Result<(), LandError> {
            let _ = executable;
            let parent = self
                .path
                .parent()
                .ok_or_else(|| LandError::UnsafePath(self.path.clone()))?;
            std::fs::create_dir_all(parent)?;
            let mut destination = File::create(&self.path)?;
            std::io::copy(source, &mut destination)?;
            destination.sync_all()?;
            Ok(())
        }
    }
}
