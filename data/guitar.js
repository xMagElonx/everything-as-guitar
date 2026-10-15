/* 由 tools/make_guitar.mjs 生成 —— 不要手改，改生成器再生成。 */
window.FM1_GUITAR = {
  "schema": 1,
  "label": "FM 吉他（本项目原创）",
  "origin": "original",
  "licence": "CC0-1.0",
  "note": "两个原创吉他类音色，由 tools/make_guitar.mjs 按实测数据生成；测量值刻画的是本仓库近似引擎（fm.js）里的形状，真机另有出入。",
  "voices": [
    {
      "name": "AC PLUCK",
      "raw": "58373c462d00000032000000380c2d020058183c463200000032000000380c1e020058503c465000000032000000380c500e0058553c464100000032000000380c2d080058443c465c00000032000000380c5c0400581c3c465500000032000000380c50020063636363323232320409000000000018414320504c55434b2020",
      "design": {
        "algo": 5,
        "feedback": 1,
        "idea": "原声拨弦感：算法 5 三对算子分工 —— OP1/OP2 主体（调制器比率 2 快衰减，音头亮随后转暗）、OP3/OP4 瞬态（载波比率 4，指甲打弦的高频）、OP5/OP6 暖底（慢衰减低电平，琴体感）。没有 sustain 平台：L2=L3=0，拨弦之后只有衰减。目标：起音<12ms、质心衰减比≥2、-30dB 0.8–1.5s（C3）。",
        "measured": {
          "note48": {
            "attackMs": 2.99,
            "centroidRatio": 2.1,
            "decay30s": 0.946,
            "sustainDropDb": -28.7
          },
          "note60": {
            "attackMs": 2.99,
            "centroidRatio": 1.92
          },
          "note72": {
            "attackMs": 3.99,
            "centroidRatio": 1.97
          }
        }
      }
    },
    {
      "name": "EL GTR SUS",
      "raw": "584632411e08050032000000380c1e020058463241230a060032000000380c23020058463241280c080032000000380c2804005a2d23412d1e1a0032000000380c1c020058322841482a220032000000380c4602005a2d1e413e38370032000000380c4e02006363636332323232000b000000000018454c2047545220535553",
      "design": {
        "algo": 1,
        "feedback": 3,
        "idea": "清音电吉他：算法 1 双链 —— 主链 OP1/OP2 有 L3=55 的 sustain 平台（跌落<3dB），调制器衰到低值 sustain（留一点持续咬合，纯直音会像风琴）；副链 OP3..OP6 低电平深度调制，反馈 3 给拨弦 grit。目标：起音<10ms、质心衰减比<1.5（延音亮度稳定）。",
        "measured": {
          "note48": {
            "attackMs": 3.99,
            "centroidRatio": 1.14,
            "decay30s": 1.22,
            "sustainDropDb": 0
          },
          "note60": {
            "attackMs": 2,
            "centroidRatio": 0.98
          },
          "note72": {
            "attackMs": 2.99,
            "centroidRatio": 1.03
          }
        }
      }
    }
  ]
};
