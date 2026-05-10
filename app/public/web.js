// How many thumbnails to load per "page" fetched from Immich
const PER_PAGE = 50

class LGallery {
  items
  lightGallery
  element
  index = PER_PAGE

  /**
   * Create a lightGallery instance and populate it with the first page of gallery items
   */
  init (params = {}) {
    // Create the lightGallery instance
    this.element = document.getElementById('lightgallery')
    this.lightGallery = lightGallery(this.element, Object.assign({
      plugins: [lgZoom, lgThumbnail, lgVideo, lgFullscreen, lgHash],
      speed: 500,
      /*
      This license key was graciously provided by LightGallery under their
      GPLv3 open-source project license:
      */
      licenseKey: '8FFA6495-676C4D30-8BFC54B6-4D0A6CEC'
      /*
      Please do not take it and use it for other projects, as it was provided
      specifically for Immich Public Proxy.

      For your own projects you can use the default license key of
      0000-0000-000-0000 as per their docs:

      https://www.lightgalleryjs.com/docs/settings/#licenseKey
      */
    }, params.lgConfig))
    this.items = params.items
    this.setupLivePhotoHover()
    this.setupLightboxLivePhoto()

    const spinner = document.getElementById('loading-spinner')
    if (spinner) {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          lgallery.loadMoreItems(observer, spinner)
        }
      }, { rootMargin: '200px' })
      observer.observe(spinner)
    }
  }

  /**
   * Add a play button to the lightGallery toolbar for Live Photo slides.
   * The button is shown/hidden as the user navigates between slides.
   */
  setupLightboxLivePhoto () {
    this.element.addEventListener('lgAfterOpen', (e) => {
      this.onLgSlideChange(e.detail?.index ?? 0)
    })
    this.element.addEventListener('lgAfterSlide', (e) => {
      this.onLgSlideChange(e.detail.index)
    })
    this.element.addEventListener('lgBeforeClose', () => {
      this.stopLivePhotoPlayback()
      document.querySelector('.lg-live-photo-btn')?.remove()
    })
  }

  onLgSlideChange (index) {
    this.stopLivePhotoPlayback()
    const videoUrl = this.getLivePhotoVideoUrl(index)
    let btn = document.querySelector('.lg-live-photo-btn')

    if (videoUrl) {
      if (!btn) {
        btn = document.createElement('button')
        btn.className = 'lg-live-photo-btn lg-icon'
        btn.title = 'Play Live Photo'
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
        const toolbar = document.querySelector('.lg-toolbar')
        if (toolbar) toolbar.insertBefore(btn, toolbar.children[1] ?? null)
      }
      btn.style.display = ''
      btn.onclick = () => this.toggleLivePhotoPlayback(index)
    } else if (btn) {
      btn.style.display = 'none'
    }
  }

  getLivePhotoVideoUrl (index) {
    return this.element.querySelectorAll('a')[index]?.getAttribute('data-live-photo-video') || null
  }

  toggleLivePhotoPlayback (index) {
    if (document.querySelector('.lg-live-photo-overlay')) {
      this.stopLivePhotoPlayback()
      return
    }
    const videoUrl = this.getLivePhotoVideoUrl(index)
    const imgWrap = document.querySelector('.lg-current .lg-img-wrap')
    if (!videoUrl || !imgWrap) return

    const video = document.createElement('video')
    video.className = 'lg-live-photo-overlay'
    video.src = videoUrl
    video.muted = true
    video.loop = true
    video.playsInline = true
    imgWrap.appendChild(video)
    video.play().catch(() => {})
    document.querySelector('.lg-live-photo-btn')?.classList.add('lg-live-photo-btn--active')
  }

  stopLivePhotoPlayback () {
    const video = document.querySelector('.lg-live-photo-overlay')
    if (video) { video.pause(); video.remove() }
    document.querySelector('.lg-live-photo-btn')?.classList.remove('lg-live-photo-btn--active')
  }

  /**
   * Attach hover-to-play behaviour to any Live Photo thumbnails not yet initialised.
   * Safe to call multiple times — skips anchors already set up.
   */
  setupLivePhotoHover () {
    document.querySelectorAll('[data-live-photo-video]:not([data-live-photo-init])').forEach(anchor => {
      anchor.setAttribute('data-live-photo-init', '1')
      const videoUrl = anchor.getAttribute('data-live-photo-video')
      let videoEl = null

      const getVideo = () => {
        if (!videoEl) {
          videoEl = document.createElement('video')
          videoEl.className = 'live-photo-video'
          videoEl.src = videoUrl
          videoEl.muted = true
          videoEl.loop = true
          videoEl.playsInline = true
          anchor.appendChild(videoEl)
        }
        return videoEl
      }

      anchor.addEventListener('mouseenter', () => getVideo().play().catch(() => {}))
      anchor.addEventListener('mouseleave', () => {
        if (videoEl) {
          videoEl.pause()
          videoEl.currentTime = 0
        }
      })
    })
  }

  /**
   * Load more gallery items as per lightGallery docs
   * https://www.lightgalleryjs.com/demos/infinite-scrolling/
   */
  loadMoreItems (observer, spinner) {
    if (this.index < this.items.length) {
      // Append new thumbnails
      this.items
        .slice(this.index, this.index + PER_PAGE)
        .forEach(item => {
          this.element.insertAdjacentHTML('beforeend', item.html + '\n')
        })
      this.index += PER_PAGE
      this.lightGallery.refresh()
      this.setupLivePhotoHover()
    } else {
      // Remove the loading spinner and stop observing once all items are loaded
      observer.disconnect()
      spinner.remove()
    }
  }
}
const lgallery = new LGallery()
