/* 由 tools/make_guitar.mjs 生成 —— 不要手改，改生成器再生成。 */
window.FM1_GUITAR = {
  "schema": 1,
  "label": "FM 吉他（本项目原创）",
  "origin": "original",
  "licence": "CC0-1.0",
  "note": "两个原创吉他类音色，由 tools/make_guitar.mjs 按实测数据生成（v2：原厂 GUITAR 1 骨架）；测量值刻画的是本仓库近似引擎（fm.js）里的形状，真机另有出入。",
  "voices": [
    {
      "name": "AC PLUCK",
      "raw": "553c3246480000003c0014003b10461800553a32464b000000320000003a0c4b06005538324652000000320000003a10550600551c324650000000320000003808480200553732465c00000032000000380c5c060055183246550000003200000038084e0200233c3c3c40323232070f000000000018414320504c55434b2020",
      "design": {
        "algo": 8,
        "feedback": 7,
        "idea": "原声拨弦 v2：按原厂 GUITAR 1（ROM1A #12）骨架重做 —— 算法 8、反馈 7 拉满（OP4）、比率堆栈 12:3:1（OP6 高次泛音给琴体、OP5/4=3、OP3/1=1 载波对）、全算子无延音（L2=L3=0）、OP2 慢衰减给余亮、力度灵敏度布在全部算子（轻扫暗重扫亮）、键位缩放截高音亮度、音高包络 +84 音分快速回落做拨弦瞬态。",
        "measured": {
          "note48": {
            "attackMs": 4.99,
            "brightDrop": 3.45,
            "brightCurve": [
              427,
              163,
              124,
              122
            ],
            "decay30s": 1.181,
            "sustainDropDb": -21.66,
            "brightVelRatio": 2.48
          },
          "note60": {
            "attackMs": 3.99,
            "brightDrop": 3.14
          },
          "note72": {
            "attackMs": 4.99,
            "brightDrop": 3.34
          }
        }
      }
    },
    {
      "name": "EL GTR SUS",
      "raw": "582e26413a1e14003c0014003b10421800582a224140281e00320000003a0c46060058261e414a2e2400320000003a10500600581e18414e4341003200000038084802005816184150423e0032000000380c560600581c1841524947003200000038084e0200283c3c3c3a323232070f000000000018454c2047545220535553",
      "design": {
        "algo": 8,
        "feedback": 7,
        "idea": "清音电吉他 v2：同 GUITAR 1 骨架，载波 L3>0 给 sustain 平台（跌落<3dB）、OP2 慢衰减延亮度（R2=22/L2=62），调制链衰到低值 sustain 留持续咬合；音高包络 +48 音分轻微瞬态。",
        "measured": {
          "note48": {
            "attackMs": 3.99,
            "brightDrop": 0.53,
            "brightCurve": [
              209,
              202,
              250,
              427
            ],
            "decay30s": 1.212,
            "sustainDropDb": -1.91,
            "brightVelRatio": 1.41
          },
          "note60": {
            "attackMs": 4.99,
            "brightDrop": 0.68
          },
          "note72": {
            "attackMs": 2.99,
            "brightDrop": 1.58
          }
        }
      }
    }
  ]
};
