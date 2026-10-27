#ifndef SERA_MPV_H
#define SERA_MPV_H
#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <dlfcn.h>

/* A aplicação já está ligada ao OpenGL.framework; não há busca fora do bundle. */
static inline void *sera_gl_address(void *ctx, const char *name) {
    (void)ctx;
    return dlsym(RTLD_DEFAULT, name);
}

static inline int sera_mpv_render_create(mpv_render_context **render, mpv_handle *mpv) {
    mpv_opengl_init_params gl = { .get_proc_address = sera_gl_address };
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl },
        { MPV_RENDER_PARAM_INVALID, NULL }
    };
    return mpv_render_context_create(render, mpv, params);
}

static inline int sera_mpv_render(mpv_render_context *render, int width, int height) {
    mpv_opengl_fbo fbo = { .fbo = 0, .w = width, .h = height, .internal_format = 0 };
    int flip = 1;
    /* Não bloquear o loop AppKit esperando o relógio do vídeo. O swap usa vsync. */
    int block = 0;
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip },
        { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block },
        { MPV_RENDER_PARAM_INVALID, NULL }
    };
    return mpv_render_context_render(render, params);
}
#endif
