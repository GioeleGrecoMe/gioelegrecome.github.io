/*
 * Room Scanner V30 - tiny WASM visual front-end.
 *
 * This is deliberately not a full SLAM implementation. It is the performance
 * critical front-end used by the JS keyframe/landmark SLAM: FAST-like corners,
 * BRIEF-style descriptors, and frame-to-frame Hamming matching run inside
 * WebAssembly. Pose graph, metric scale, depth fusion and Gaussian mapping stay
 * in inspectable JS so diagnostics are easy to export from a phone.
 *
 * Build target: freestanding wasm32, no libc and no Emscripten runtime.
 */

#include <stdint.h>

/* Freestanding wasm: provide tiny libc primitives explicitly so optimized
 * builds never acquire hidden env imports that GitHub Pages cannot satisfy. */
void *memcpy(void *dst, const void *src, unsigned long n) {
    uint8_t *d=(uint8_t*)dst; const uint8_t *s=(const uint8_t*)src;
    for(unsigned long i=0;i<n;i++) d[i]=s[i];
    return dst;
}

#define MAX_W 640
#define MAX_H 480
#define MAX_PIXELS (MAX_W * MAX_H)
#define MAX_FEATURES 1400
#define DESC_BYTES 16

static uint8_t g_image[MAX_PIXELS];
static uint16_t g_curr_x[MAX_FEATURES], g_curr_y[MAX_FEATURES];
static uint16_t g_prev_x[MAX_FEATURES], g_prev_y[MAX_FEATURES];
static uint16_t g_curr_score[MAX_FEATURES], g_prev_score[MAX_FEATURES];
static uint8_t g_curr_desc[MAX_FEATURES * DESC_BYTES];
static uint8_t g_prev_desc[MAX_FEATURES * DESC_BYTES];
static int16_t g_match_curr[MAX_FEATURES], g_match_prev[MAX_FEATURES];
static uint16_t g_match_dist[MAX_FEATURES];
static int g_curr_count = 0, g_prev_count = 0, g_match_count = 0;

static int iabs(int x) { return x < 0 ? -x : x; }
static int min_i(int a, int b) { return a < b ? a : b; }
static int max_i(int a, int b) { return a > b ? a : b; }

static uint16_t fast_score(const uint8_t *img, int w, int x, int y, int threshold) {
    static const int8_t ox[16] = {0,1,2,3,3,3,2,1,0,-1,-2,-3,-3,-3,-2,-1};
    static const int8_t oy[16] = {-3,-3,-2,-1,0,1,2,3,3,3,2,1,0,-1,-2,-3};
    const int c = img[y*w + x];
    int bright[32], dark[32], score = 0;
    for (int i = 0; i < 16; ++i) {
        int v = img[(y + oy[i])*w + (x + ox[i])];
        int d = v - c;
        bright[i] = bright[i+16] = d > threshold;
        dark[i] = dark[i+16] = d < -threshold;
        score += iabs(d);
    }
    int run_b = 0, run_d = 0, best_b = 0, best_d = 0;
    for (int i = 0; i < 32; ++i) {
        run_b = bright[i] ? run_b + 1 : 0;
        run_d = dark[i] ? run_d + 1 : 0;
        best_b = max_i(best_b, run_b);
        best_d = max_i(best_d, run_d);
        if (best_b >= 9 || best_d >= 9) break;
    }
    if (best_b < 9 && best_d < 9) return 0;
    if (score > 65535) score = 65535;
    return (uint16_t)score;
}

/* Deterministic BRIEF pair generator. The exact pair pattern is not sacred;
 * stability across frames matters more than reproducing OpenCV's ORB pattern. */
static int brief_off(int k, int axis, int which) {
    uint32_t s = 0x9e3779b9u ^ (uint32_t)(k * 2654435761u + axis*7919u + which*104729u);
    s ^= s >> 13; s *= 1274126177u; s ^= s >> 16;
    return (int)(s % 15u) - 7;
}

static void compute_desc(const uint8_t *img, int w, int x, int y, uint8_t *out) {
    for (int b = 0; b < DESC_BYTES; ++b) {
        uint8_t byte = 0;
        for (int bit = 0; bit < 8; ++bit) {
            int k = b*8 + bit;
            int x1 = x + brief_off(k, 0, 0), y1 = y + brief_off(k, 1, 0);
            int x2 = x + brief_off(k, 0, 1), y2 = y + brief_off(k, 1, 1);
            if (img[y1*w + x1] < img[y2*w + x2]) byte |= (uint8_t)(1u << bit);
        }
        out[b] = byte;
    }
}

static int popcount8(uint8_t v) {
    v = (uint8_t)(v - ((v >> 1) & 0x55));
    v = (uint8_t)((v & 0x33) + ((v >> 2) & 0x33));
    return (v + (v >> 4)) & 0x0F;
}

static int hamming(const uint8_t *a, const uint8_t *b) {
    int d = 0;
    for (int i = 0; i < DESC_BYTES; ++i) d += popcount8((uint8_t)(a[i] ^ b[i]));
    return d;
}

/* One strongest corner per grid cell gives an even spatial distribution. */
static int detect_features(int w, int h, int max_features, int threshold) {
    if (max_features < 32) max_features = 32;
    if (max_features > MAX_FEATURES) max_features = MAX_FEATURES;
    int area = w * h;
    int cell = 10;
    if (max_features < 500) cell = 14;
    if (max_features < 260) cell = 18;
    int count = 0;
    for (int cy = 8; cy < h - 8 && count < max_features; cy += cell) {
        for (int cx = 8; cx < w - 8 && count < max_features; cx += cell) {
            uint16_t best = 0; int bx = 0, by = 0;
            int y_end = min_i(cy + cell, h - 8), x_end = min_i(cx + cell, w - 8);
            for (int y = cy; y < y_end; y += 2) {
                int row = y*w;
                for (int x = cx; x < x_end; x += 2) {
                    (void)row;
                    uint16_t s = fast_score(g_image, w, x, y, threshold);
                    if (s > best) { best = s; bx = x; by = y; }
                }
            }
            if (best) {
                g_curr_x[count] = (uint16_t)bx;
                g_curr_y[count] = (uint16_t)by;
                g_curr_score[count] = best;
                compute_desc(g_image, w, bx, by, &g_curr_desc[count*DESC_BYTES]);
                ++count;
            }
        }
    }
    (void)area;
    return count;
}

static int match_features(int w, int h) {
    (void)h;
    g_match_count = 0;
    if (g_prev_count <= 0 || g_curr_count <= 0) return 0;
    const int max_motion = max_i(90, w / 3);
    for (int ci = 0; ci < g_curr_count && g_match_count < MAX_FEATURES; ++ci) {
        int best = 999, second = 999, best_pi = -1;
        int cx = g_curr_x[ci], cy = g_curr_y[ci];
        const uint8_t *cd = &g_curr_desc[ci*DESC_BYTES];
        for (int pi = 0; pi < g_prev_count; ++pi) {
            if (iabs(cx - (int)g_prev_x[pi]) > max_motion || iabs(cy - (int)g_prev_y[pi]) > max_motion) continue;
            int d = hamming(cd, &g_prev_desc[pi*DESC_BYTES]);
            if (d < best) { second = best; best = d; best_pi = pi; }
            else if (d < second) second = d;
        }
        /* Conservative ratio + absolute threshold. */
        if (best_pi >= 0 && best <= 52 && best*100 < second*82) {
            g_match_curr[g_match_count] = (int16_t)ci;
            g_match_prev[g_match_count] = (int16_t)best_pi;
            g_match_dist[g_match_count] = (uint16_t)best;
            ++g_match_count;
        }
    }
    return g_match_count;
}

static void copy_curr_to_prev(void) {
    g_prev_count = g_curr_count;
    for (int i = 0; i < g_curr_count; ++i) {
        g_prev_x[i] = g_curr_x[i]; g_prev_y[i] = g_curr_y[i]; g_prev_score[i] = g_curr_score[i];
        for (int b = 0; b < DESC_BYTES; ++b) g_prev_desc[i*DESC_BYTES+b] = g_curr_desc[i*DESC_BYTES+b];
    }
}

__attribute__((export_name("input_ptr"))) int input_ptr(void) { return (int)(uintptr_t)g_image; }
__attribute__((export_name("max_pixels"))) int max_pixels(void) { return MAX_PIXELS; }
__attribute__((export_name("max_width"))) int max_width(void) { return MAX_W; }
__attribute__((export_name("max_height"))) int max_height(void) { return MAX_H; }
__attribute__((export_name("reset"))) void reset(void) { g_curr_count = g_prev_count = g_match_count = 0; }

__attribute__((export_name("process_frame")))
int process_frame(int w, int h, int max_features, int threshold) {
    if (w < 32 || h < 24 || w > MAX_W || h > MAX_H || w*h > MAX_PIXELS) return -1;
    if (threshold < 6) threshold = 6; if (threshold > 80) threshold = 80;
    g_curr_count = detect_features(w, h, max_features, threshold);
    match_features(w, h);
    /* The output match indices reference the previous-frame feature list that
     * JS still owns. Only after matching do we advance the internal history. */
    copy_curr_to_prev();
    return g_curr_count;
}

__attribute__((export_name("feature_count"))) int feature_count(void) { return g_curr_count; }
__attribute__((export_name("match_count"))) int match_count(void) { return g_match_count; }
__attribute__((export_name("curr_x_ptr"))) int curr_x_ptr(void) { return (int)(uintptr_t)g_curr_x; }
__attribute__((export_name("curr_y_ptr"))) int curr_y_ptr(void) { return (int)(uintptr_t)g_curr_y; }
__attribute__((export_name("curr_score_ptr"))) int curr_score_ptr(void) { return (int)(uintptr_t)g_curr_score; }
__attribute__((export_name("curr_desc_ptr"))) int curr_desc_ptr(void) { return (int)(uintptr_t)g_curr_desc; }
__attribute__((export_name("match_curr_ptr"))) int match_curr_ptr(void) { return (int)(uintptr_t)g_match_curr; }
__attribute__((export_name("match_prev_ptr"))) int match_prev_ptr(void) { return (int)(uintptr_t)g_match_prev; }
__attribute__((export_name("match_dist_ptr"))) int match_dist_ptr(void) { return (int)(uintptr_t)g_match_dist; }
__attribute__((export_name("descriptor_bytes"))) int descriptor_bytes(void) { return DESC_BYTES; }

/* ------------------------- metric PnP refinement ------------------------- */
#define MAX_PNP 220
static float g_pnp_world[MAX_PNP*3];
static float g_pnp_uv[MAX_PNP*2];
/* World-to-camera transform: row-major R (9) followed by t (3). */
static float g_pnp_pose[12] = {1,0,0,0,1,0,0,0,1,0,0,0};
static float g_pnp_last_rmse = 0.0f;

static float fabs_f(float x){ return x < 0.0f ? -x : x; }
static float sqrt_f(float x){ return __builtin_sqrtf(x); }

static int solve6f(float H[6][6], float b[6], float x[6]){
    float M[6][7];
    for(int r=0;r<6;r++){ for(int c=0;c<6;c++)M[r][c]=H[r][c]; M[r][6]=b[r]; }
    for(int c=0;c<6;c++){
        int piv=c; for(int r=c+1;r<6;r++) if(fabs_f(M[r][c])>fabs_f(M[piv][c]))piv=r;
        if(fabs_f(M[piv][c])<1e-8f)return 0;
        if(piv!=c)for(int j=c;j<7;j++){float tmp=M[c][j];M[c][j]=M[piv][j];M[piv][j]=tmp;}
        float d=M[c][c];for(int j=c;j<7;j++)M[c][j]/=d;
        for(int r=0;r<6;r++){if(r==c)continue;float f=M[r][c];for(int j=c;j<7;j++)M[r][j]-=f*M[c][j];}
    }
    for(int i=0;i<6;i++)x[i]=M[i][6];return 1;
}

static void orthonormalize(float *R){
    /* Gram-Schmidt rows; sufficient after tiny Gauss-Newton increments. */
    float n0=sqrt_f(R[0]*R[0]+R[1]*R[1]+R[2]*R[2]);if(n0<1e-8f)n0=1;R[0]/=n0;R[1]/=n0;R[2]/=n0;
    float dot=R[3]*R[0]+R[4]*R[1]+R[5]*R[2];R[3]-=dot*R[0];R[4]-=dot*R[1];R[5]-=dot*R[2];
    float n1=sqrt_f(R[3]*R[3]+R[4]*R[4]+R[5]*R[5]);if(n1<1e-8f)n1=1;R[3]/=n1;R[4]/=n1;R[5]/=n1;
    R[6]=R[1]*R[5]-R[2]*R[4];R[7]=R[2]*R[3]-R[0]*R[5];R[8]=R[0]*R[4]-R[1]*R[3];
}

__attribute__((export_name("pnp_world_ptr"))) int pnp_world_ptr(void){return (int)(uintptr_t)g_pnp_world;}
__attribute__((export_name("pnp_uv_ptr"))) int pnp_uv_ptr(void){return (int)(uintptr_t)g_pnp_uv;}
__attribute__((export_name("pnp_pose_ptr"))) int pnp_pose_ptr(void){return (int)(uintptr_t)g_pnp_pose;}
__attribute__((export_name("pnp_rmse"))) float pnp_rmse(void){return g_pnp_last_rmse;}

__attribute__((export_name("pnp_optimize")))
int pnp_optimize(int n,float fx,float fy,float cx,float cy,int iterations){
    if(n<8)return 0;if(n>MAX_PNP)n=MAX_PNP;if(iterations<1)iterations=1;if(iterations>8)iterations=8;
    float *R=g_pnp_pose,*t=&g_pnp_pose[9];
    for(int it=0;it<iterations;it++){
        float H[6][6]={{0}},g[6]={0};int used=0;
        for(int i=0;i<n;i++){
            float X=g_pnp_world[i*3],Y=g_pnp_world[i*3+1],Z=g_pnp_world[i*3+2];
            float x=R[0]*X+R[1]*Y+R[2]*Z+t[0],y=R[3]*X+R[4]*Y+R[5]*Z+t[1],z=R[6]*X+R[7]*Y+R[8]*Z+t[2];
            if(z<0.08f||z>30.0f)continue;float u=fx*x/z+cx,v=cy-fy*y/z,ru=u-g_pnp_uv[i*2],rv=v-g_pnp_uv[i*2+1],rn=sqrt_f(ru*ru+rv*rv);if(rn>40.0f)continue;float w=rn<=3.0f?1.0f:3.0f/rn;
            float du_dx=fx/z,du_dz=-fx*x/(z*z),dv_dy=-fy/z,dv_dz=fy*y/(z*z);
            /* dr x p columns: [0,-z,y], [z,0,-x], [-y,x,0] */
            float J0[6]={du_dx,0,du_dz, du_dz*y, du_dx*z-du_dz*x, -du_dx*y};
            float J1[6]={0,dv_dy,dv_dz, -dv_dy*z+dv_dz*y, -dv_dz*x, dv_dy*x};
            for(int a=0;a<6;a++){g[a]+=w*(J0[a]*ru+J1[a]*rv);for(int b=0;b<6;b++)H[a][b]+=w*(J0[a]*J0[b]+J1[a]*J1[b]);}used++;
        }
        if(used<8)break;for(int d=0;d<6;d++)H[d][d]+=1e-4f;float rhs[6],dx[6];for(int i=0;i<6;i++)rhs[i]=-g[i];if(!solve6f(H,rhs,dx))break;
        /* Left-multiply camera transform by exp([dr]x) first-order. */
        float rx=dx[3],ry=dx[4],rz=dx[5],oldR[9];for(int i=0;i<9;i++)oldR[i]=R[i];
        for(int c=0;c<3;c++){float a=oldR[c],b=oldR[3+c],cc=oldR[6+c];R[c]=a- rz*b+ry*cc;R[3+c]=rz*a+b-rx*cc;R[6+c]=-ry*a+rx*b+cc;}
        float tx=t[0],ty=t[1],tz=t[2];t[0]=tx-rz*ty+ry*tz+dx[0];t[1]=rz*tx+ty-rx*tz+dx[1];t[2]=-ry*tx+rx*ty+tz+dx[2];orthonormalize(R);
        float dn=0;for(int i=0;i<6;i++)dn+=dx[i]*dx[i];if(dn<1e-8f)break;
    }
    int inliers=0;float se=0;for(int i=0;i<n;i++){float X=g_pnp_world[i*3],Y=g_pnp_world[i*3+1],Z=g_pnp_world[i*3+2],x=R[0]*X+R[1]*Y+R[2]*Z+t[0],y=R[3]*X+R[4]*Y+R[5]*Z+t[1],z=R[6]*X+R[7]*Y+R[8]*Z+t[2];if(z<.08f)continue;float u=fx*x/z+cx,v=cy-fy*y/z,du=u-g_pnp_uv[i*2],dv=v-g_pnp_uv[i*2+1],er=sqrt_f(du*du+dv*dv);if(er<8.0f){se+=er*er;inliers++;}}
    g_pnp_last_rmse=inliers?sqrt_f(se/(float)inliers):9999.0f;return inliers;
}
